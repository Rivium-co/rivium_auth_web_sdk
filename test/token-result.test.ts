import { describe, expect, it, vi } from 'vitest';
import { RiviumAuth } from '../src/client';
import { MemoryStorage } from '../src/storage';
import { decodeTokenPayload, tokenResultOf } from '../src/token-result';
import type { FetchLike } from '../src/types';

/** A token shaped like the ones Rivium signs (the signature isn't checked by the SDK, only by Rivium's servers). */
const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const jwt = (payload: Record<string, unknown>) => `${b64url('{"alg":"ES256","typ":"JWT"}')}.${b64url(JSON.stringify(payload))}.c2ln`;
const NOW = 1_793_000_000;
const STANDARD = { iss: 'rivium', aud: 'rivium_user', sub: 'ru_user1', pid: 'p1', iat: NOW, exp: NOW + 3600, auth_time: NOW - 86_400, amr: ['google'], meta: { pid: 'p1', srv: true, iat: NOW } };

describe('getTokenResult (Firebase getIdTokenResult)', () => {
  it("decodes every field, flat, custom claims included; meta is Rivium's own and left out", () => {
    const token = jwt({ ...STANDARD, plan: 'pro', team: { id: 't1', role: 'editor' }, نقش: 'مدیر' });
    const r = tokenResultOf(token)!;
    expect(r.token).toBe(token);
    expect(r.claims).toEqual({ ...STANDARD, meta: undefined, plan: 'pro', team: { id: 't1', role: 'editor' }, نقش: 'مدیر' });
    expect(r.claims).not.toHaveProperty('meta');
    expect(r.expirationTime).toBe(new Date((NOW + 3600) * 1000).toISOString());
    expect(r.issuedAtTime).toBe(new Date(NOW * 1000).toISOString());
    expect(r.authTime).toBe(new Date((NOW - 86_400) * 1000).toISOString());
    expect(r.signInProvider).toBe('google');
  });

  it('reads UTF-8 (Farsi, emoji) exactly; a broken token gives null, never a throw', () => {
    expect(decodeTokenPayload(jwt({ a: 'سلام 👋' }))).toEqual({ a: 'سلام 👋' });
    expect(decodeTokenPayload('not.a.token!')).toBeNull();
    expect(decodeTokenPayload('one-part')).toBeNull();
    expect(tokenResultOf(jwt({ sub: 'x' }))).toBeNull(); // no exp / iat
  });

  it('without auth_time (older tokens) authTime falls back to the issue time', () => {
    const { auth_time: _a, ...old } = STANDARD;
    expect(tokenResultOf(jwt(old))!.authTime).toBe(new Date(NOW * 1000).toISOString());
  });

  it('from the client: null when signed out; forceRefresh gets the new claims at once', async () => {
    let plan = 'free';
    const fetch: FetchLike = vi.fn(async (url: string) => {
      const path = url.replace('https://auth-users.rivium.co', '');
      const now = Math.floor(Date.now() / 1000);
      const accessToken = jwt({ ...STANDARD, iat: now, exp: now + 3600, plan });
      const body = path === '/v1/anonymous' || path === '/v1/token/refresh'
        ? { accessToken, expiresIn: 3600, expiresAt: new Date((now + 3600) * 1000).toISOString(), refreshToken: 'refresh_token_xxxxxxxxxxxxxxxx', userId: 'ru_user1' }
        : {};
      const text = JSON.stringify(body);
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => text };
    }) as unknown as FetchLike;
    const auth = new RiviumAuth({ apiKey: 'rv_live_test', storage: new MemoryStorage(), fetch });
    expect(await auth.getTokenResult()).toBeNull();
    await auth.signInAnonymously();
    expect((await auth.getTokenResult())!.claims.plan).toBe('free');
    plan = 'pro'; // the developer's server changed the claims
    expect((await auth.getTokenResult())!.claims.plan).toBe('free'); // cached token until it is refreshed
    expect((await auth.getTokenResult({ forceRefresh: true }))!.claims.plan).toBe('pro');
  });

  it('custom claims nested under `claims` (Rivium server) come out by name; token fields win', () => {
    const { auth_time: _a, ...rest } = STANDARD;
    const r = tokenResultOf(jwt({ ...rest, claims: { levels: ['A1'], sub: 'someone-else' } }))!;
    expect(r.claims.levels).toEqual(['A1']);
    expect(r.claims.sub).toBe('ru_user1');
    expect(r.claims).not.toHaveProperty('claims');
    expect(r.authTime).toBe(r.issuedAtTime);
  });
});
