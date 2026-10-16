import { describe, expect, it, vi } from 'vitest';
import { RiviumAuth } from '../src/client';
import { RiviumAuthError } from '../src/errors';
import { MemoryStorage } from '../src/storage';
import { createNonce } from '../src/nonce';
import { sha256, sha256Hex, toHex } from '../src/sha256';
import type { FetchLike } from '../src/types';

const API_KEY = 'rv_live_test';
const KEY = `rivium_auth.${API_KEY}`;

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
type Handler = (path: string, body: any, headers: Record<string, string>) => Reply | Promise<Reply>;

/** A fake Rivium Auth server: rotates refresh tokens like the real one. */
function fakeServer() {
  let n = 0;
  const live = new Set<string>();
  const calls: { method: string; path: string; body: any; headers: Record<string, string> }[] = [];
  const overrides = new Map<string, Handler>();
  let refreshGate: Promise<void> | null = null;

  const issue = (userId = 'ru_user1') => {
    n++;
    const refreshToken = `refresh_token_${n}_xxxxxxxxxxxxxxxx`;
    live.add(refreshToken);
    return { accessToken: `access_${n}`, expiresIn: 3600, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), refreshToken, userId };
  };

  const fetch: FetchLike = vi.fn(async (url, init) => {
    const path = url.replace('https://auth-users.rivium.co', '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, body, headers: init.headers });
    let reply: Reply;
    const o = overrides.get(path);
    if (o) reply = await o(path, body, init.headers);
    else if (path === '/v1/anonymous') reply = { status: 200, body: issue() };
    else if (path === '/v1/token/refresh') {
      if (refreshGate) await refreshGate;
      if (!live.delete(body.refreshToken)) reply = { status: 401, body: { code: 'SESSION_REVOKED', message: 'Session ended' } };
      else reply = { status: 200, body: issue() };
    } else if (path === '/v1/me' && init.method === 'DELETE') reply = { status: 204 };
    else if (path === '/v1/me') reply = { status: 200, body: { id: 'ru_user1', anonymous: true, emailVerified: false, createdAt: '2026-10-16T00:00:00.000Z', providers: [] } };
    else if (path === '/v1/sign-out') reply = { status: 204 };
    else reply = { status: 404, body: { code: 'INVALID_INPUT', message: 'Not found' } };
    const text = reply.body === undefined ? '' : JSON.stringify(reply.body);
    const headers = reply.headers ?? {};
    return { ok: reply.status < 300, status: reply.status, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, text: async () => text };
  });

  return {
    fetch,
    calls,
    live,
    issue,
    overrides,
    count: (path: string) => calls.filter((c) => c.path === path).length,
    holdRefresh() {
      let release!: () => void;
      refreshGate = new Promise<void>((r) => (release = r));
      return () => {
        refreshGate = null;
        release();
      };
    },
  };
}

function setup(opts: { storage?: MemoryStorage; now?: () => number } = {}) {
  const server = fakeServer();
  const storage = opts.storage ?? new MemoryStorage();
  const auth = new RiviumAuth({ apiKey: API_KEY, storage, fetch: server.fetch }, opts.now);
  return { server, storage, auth };
}

describe('sign-in', () => {
  it('stores the session: access token in memory, refresh token in storage', async () => {
    const { server, storage, auth } = setup();
    const res = await auth.signInAnonymously();
    expect(res.userId).toBe('ru_user1');
    expect(auth.currentUserId).toBe('ru_user1');
    expect(await auth.getToken()).toBe('access_1');
    const stored = JSON.parse((await storage.get(KEY)) as string);
    expect(stored).toEqual({ refreshToken: 'refresh_token_1_xxxxxxxxxxxxxxxx', userId: 'ru_user1' });
    expect(JSON.stringify(stored)).not.toContain('access_');
    expect(server.calls[0].headers['x-api-key']).toBe(API_KEY);
    expect(server.calls[0].headers.Authorization).toBeUndefined();
  });

  it('sends the raw nonce to Apple sign-in and reports created', async () => {
    const { server, auth } = setup();
    server.overrides.set('/v1/apple', () => ({ status: 200, body: { ...server.issue('ru_apple'), created: true } }));
    const res = await auth.signInWithApple({ idToken: 'id.tok.en', rawNonce: 'raw-nonce-0123456789' });
    expect(res).toEqual({ userId: 'ru_apple', created: true });
    expect(server.calls[0].body).toMatchObject({ idToken: 'id.tok.en', nonce: 'raw-nonce-0123456789' });
  });

  it('restores the session from storage after a restart and refreshes on first use', async () => {
    const first = setup();
    await first.auth.signInAnonymously();
    const auth2 = new RiviumAuth({ apiKey: API_KEY, storage: first.storage, fetch: first.server.fetch });
    const seen: (string | null)[] = [];
    auth2.onAuthStateChanged((id) => seen.push(id));
    await auth2.ready();
    expect(auth2.currentUserId).toBe('ru_user1');
    expect(await auth2.getToken()).toBe('access_2');
    expect(first.server.count('/v1/token/refresh')).toBe(1);
    expect(seen).toEqual(['ru_user1']);
  });

  it('typed errors carry the server code', async () => {
    const { server, auth } = setup();
    server.overrides.set('/v1/link/apple', () => ({ status: 409, body: { code: 'PROVIDER_ALREADY_LINKED', message: 'already used' } }));
    await auth.signInAnonymously();
    const err = await auth.linkApple({ idToken: 'x', rawNonce: 'y'.repeat(20) }).catch((e) => e);
    expect(err).toBeInstanceOf(RiviumAuthError);
    expect(err.code).toBe('PROVIDER_ALREADY_LINKED');
    expect(err.status).toBe(409);
    expect(auth.currentUserId).toBe('ru_user1'); // still signed in
  });

  it('reads RATE_LIMITED retryAfterSec', async () => {
    const { server, auth } = setup();
    server.overrides.set('/v1/anonymous', () => ({ status: 429, body: { code: 'RATE_LIMITED', message: 'slow down', retryAfterSec: 42 } }));
    const err = await auth.signInAnonymously().catch((e) => e);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryAfterSec).toBe(42);
  });
});

describe('refresh', () => {
  it('concurrent getToken calls share one refresh request', async () => {
    let now = Date.now();
    const { server, auth } = setup({ now: () => now });
    await auth.signInAnonymously();
    now += 59 * 60_000; // within 2 minutes of expiry
    const release = server.holdRefresh();
    const all = Promise.all([auth.getToken(), auth.getToken(), auth.tokenProvider(), auth.getToken(), auth.getToken()]);
    await new Promise((r) => setTimeout(r, 5));
    release();
    const tokens = await all;
    expect(new Set(tokens)).toEqual(new Set(['access_2']));
    expect(server.count('/v1/token/refresh')).toBe(1);
  });

  it('does not refresh while the token has more than 2 minutes left', async () => {
    let now = Date.now();
    const { server, auth } = setup({ now: () => now });
    await auth.signInAnonymously();
    now += 57 * 60_000;
    expect(await auth.getToken()).toBe('access_1');
    expect(server.count('/v1/token/refresh')).toBe(0);
  });

  it('saves the rotated refresh token and uses it next time', async () => {
    let now = Date.now();
    const { server, storage, auth } = setup({ now: () => now });
    await auth.signInAnonymously();
    now += 59 * 60_000;
    expect(await auth.getToken()).toBe('access_2');
    expect(JSON.parse((await storage.get(KEY)) as string).refreshToken).toBe('refresh_token_2_xxxxxxxxxxxxxxxx');
    now += 59 * 60_000;
    expect(await auth.getToken()).toBe('access_3');
    const refreshes = server.calls.filter((c) => c.path === '/v1/token/refresh').map((c) => c.body.refreshToken);
    expect(refreshes).toEqual(['refresh_token_1_xxxxxxxxxxxxxxxx', 'refresh_token_2_xxxxxxxxxxxxxxxx']);
  });

  it('a revoked session signs the user out', async () => {
    let now = Date.now();
    const { server, storage, auth } = setup({ now: () => now });
    await auth.signInAnonymously();
    const seen: (string | null)[] = [];
    auth.onAuthStateChanged((id) => seen.push(id));
    await auth.ready();
    server.live.clear(); // revoked elsewhere (sign out everywhere, reuse detected, user deleted)
    now += 59 * 60_000;
    expect(await auth.getToken()).toBeNull();
    expect(auth.currentUserId).toBeNull();
    expect(await storage.get(KEY)).toBeNull();
    expect(seen).toEqual(['ru_user1', null]);
    await expect(auth.tokenProvider()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('a network error keeps the session and the still-valid token', async () => {
    let now = Date.now();
    const { server, auth } = setup({ now: () => now });
    await auth.signInAnonymously();
    server.overrides.set('/v1/token/refresh', () => {
      throw new TypeError('Failed to fetch');
    });
    now += 59 * 60_000;
    expect(await auth.getToken()).toBe('access_1'); // still valid for ~1 minute
    now += 2 * 60_000; // now really expired
    await expect(auth.getToken()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(auth.currentUserId).toBe('ru_user1');
    server.overrides.delete('/v1/token/refresh');
    expect(await auth.getToken()).toBe('access_2');
  });

  it('MAU_LIMIT on refresh keeps the session', async () => {
    let now = Date.now();
    const { server, auth } = setup({ now: () => now });
    await auth.signInAnonymously();
    server.overrides.set('/v1/token/refresh', () => ({ status: 403, body: { code: 'MAU_LIMIT', message: 'limit' } }));
    now += 61 * 60_000;
    await expect(auth.getToken()).rejects.toMatchObject({ code: 'MAU_LIMIT' });
    expect(auth.isSignedIn).toBe(true);
  });

  it('adopts a refresh token another tab rotated instead of reusing the burned one', async () => {
    let now = Date.now();
    const storage = new MemoryStorage();
    const server = fakeServer();
    const tabA = new RiviumAuth({ apiKey: API_KEY, storage, fetch: server.fetch }, () => now);
    await tabA.signInAnonymously();
    const tabB = new RiviumAuth({ apiKey: API_KEY, storage, fetch: server.fetch }, () => now);
    await tabB.ready();
    expect(await tabB.getToken()).toBe('access_2'); // B rotates 1 -> 2
    now += 59 * 60_000;
    expect(await tabA.getToken()).toBe('access_3'); // A must send 2, not the burned 1
    expect(tabA.currentUserId).toBe('ru_user1');
    const sent = server.calls.filter((c) => c.path === '/v1/token/refresh').map((c) => c.body.refreshToken);
    expect(sent).toEqual(['refresh_token_1_xxxxxxxxxxxxxxxx', 'refresh_token_2_xxxxxxxxxxxxxxxx']);
  });

  it('a sign-out during a refresh is not undone by the refresh result', async () => {
    let now = Date.now();
    const { server, auth } = setup({ now: () => now });
    await auth.signInAnonymously();
    now += 61 * 60_000;
    const release = server.holdRefresh();
    const pending = auth.getToken();
    await new Promise((r) => setTimeout(r, 5));
    await auth.signOut();
    release();
    expect(await pending).toBeNull();
    expect(auth.currentUserId).toBeNull();
  });
});

describe('account', () => {
  it('getMe sends the bearer token and fills currentUser', async () => {
    const { server, auth } = setup();
    await auth.signInAnonymously();
    const me = await auth.getMe();
    expect(me.id).toBe('ru_user1');
    expect(auth.currentUser?.anonymous).toBe(true);
    expect(server.calls.at(-1)!.headers.Authorization).toBe('Bearer access_1');
  });

  it('deleteAccount clears the session and storage', async () => {
    const { server, storage, auth } = setup();
    await auth.signInAnonymously();
    await auth.deleteAccount();
    expect(server.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/v1/me' });
    expect(auth.currentUserId).toBeNull();
    expect(await storage.get(KEY)).toBeNull();
    expect(await auth.getToken()).toBeNull();
  });

  it('deleteAccount keeps the session when the server refuses', async () => {
    const { server, auth } = setup();
    await auth.signInAnonymously();
    server.overrides.set('/v1/me', () => ({ status: 429, body: { code: 'RATE_LIMITED', message: 'x', retryAfterSec: 60 } }));
    await expect(auth.deleteAccount()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(auth.currentUserId).toBe('ru_user1');
  });

  it('signOut clears locally and tells the server, even if the server is unreachable', async () => {
    const { server, storage, auth } = setup();
    await auth.signInAnonymously();
    server.overrides.set('/v1/sign-out', () => {
      throw new TypeError('offline');
    });
    await auth.signOut();
    expect(auth.currentUserId).toBeNull();
    expect(await storage.get(KEY)).toBeNull();
    expect(server.calls.at(-1)).toMatchObject({ path: '/v1/sign-out', body: { refreshToken: 'refresh_token_1_xxxxxxxxxxxxxxxx' } });
  });

  it('retries once with a fresh token when the server rejects the access token', async () => {
    const { server, auth } = setup();
    await auth.signInAnonymously();
    let first = true;
    server.overrides.set('/v1/me', (_p, _b, headers) => {
      if (first) {
        first = false;
        return { status: 401, body: { code: 'UNAUTHENTICATED', message: 'Sign-in required' } };
      }
      return { status: 200, body: { id: 'ru_user1', anonymous: true, emailVerified: false, createdAt: 'x', providers: [], auth: headers.Authorization } };
    });
    const me = (await auth.getMe()) as any;
    expect(me.auth).toBe('Bearer access_2');
  });

  it('sign-up without a session (verified e-mail required) stays signed out', async () => {
    const { server, auth } = setup();
    server.overrides.set('/v1/password/sign-up', () => ({ status: 200, body: { userId: 'ru_new', verificationSent: true, session: null } }));
    const res = await auth.signUpWithEmail({ email: 'a@b.co', password: 'longpassword', redirectUrl: 'https://app/verify' });
    expect(res).toEqual({ userId: 'ru_new', verificationSent: true, signedIn: false });
    expect(auth.isSignedIn).toBe(false);
  });
});

describe('nonce', () => {
  it('built-in sha256 matches known vectors and Web Crypto', async () => {
    const enc = new TextEncoder();
    expect(toHex(sha256(enc.encode('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(toHex(sha256(enc.encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const long = 'a'.repeat(1000) + 'é€😀';
    expect(toHex(sha256(enc.encode(long)))).toBe(await sha256Hex(long));
  });

  it('hashedNonce is the hex SHA-256 of rawNonce', async () => {
    const n = await createNonce();
    expect(n.rawNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(n.hashedNonce).toBe(toHex(sha256(new TextEncoder().encode(n.rawNonce))));
  });
});
