import { isRiviumAuthError, RiviumAuthError, SESSION_ENDED_CODES } from './errors';
import { createNonce, SignInNonce } from './nonce';
import { MemoryStorage, RiviumAuthStorage } from './storage';
import type {
  AppleSignInInput,
  AuthStateListener,
  EmailPasswordInput,
  FetchLike,
  GoogleSignInInput,
  RiviumAuthConfig,
  RiviumAuthMethods,
  RiviumTokenProvider,
  RiviumUser,
  SignInResult,
  SignUpResult,
  TelegramCodeResult,
} from './types';

export const DEFAULT_BASE_URL = 'https://auth-users.rivium.co';
/** A new access token is fetched this long before the current one expires. */
export const REFRESH_MARGIN_MS = 2 * 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;

/** What the server answers on every sign-in and refresh. */
interface ServerTokens {
  accessToken: string;
  expiresIn: number;
  expiresAt: string;
  refreshToken: string;
  userId: string;
}

interface Session {
  /** Null right after a restart: only the refresh token is stored. */
  accessToken: string | null;
  /** Local clock, ms. */
  accessExpiresAt: number;
  refreshToken: string;
  userId: string;
}

interface Stored {
  refreshToken: string;
  userId: string;
}

/**
 * Rivium Auth client: signs users in, keeps their session fresh, and hands a user token to the other Rivium SDKs.
 * Create one per app with `createRiviumAuth`.
 */
export class RiviumAuth {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly storage: RiviumAuthStorage;
  private readonly storageKey: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;

  private session: Session | null = null;
  private user: RiviumUser | null = null;
  /** Bumped whenever the session is replaced or cleared, so a slower request never overwrites newer state. */
  private generation = 0;
  private refreshing: Promise<string | null> | null = null;
  /** Each listener with the last value it was given, so none hears the same state twice. */
  private readonly listeners = new Map<AuthStateListener, { last: string | null | undefined }>();
  private readonly readyPromise: Promise<void>;

  constructor(config: RiviumAuthConfig, now: () => number = Date.now) {
    if (!config || typeof config.apiKey !== 'string' || !config.apiKey.trim()) {
      throw new RiviumAuthError('INVALID_API_KEY', 'apiKey is required');
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.storage = config.storage ?? new MemoryStorage();
    this.storageKey = config.storageKey ?? `rivium_auth.${this.apiKey.replace(/[^A-Za-z0-9._-]/g, '_')}`;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
    this.fetchFn = config.fetch ?? ((url, init) => (globalFetch as FetchLike)(url, init));
    this.now = now;
    this.readyPromise = this.restore();
  }

  // ── State ─────────────────────────────────────────────────────────────────────────────────────

  /** Resolves once the stored session (if any) has been loaded. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** The signed-in user's id, or null. Wait for `ready()` after a restart. */
  get currentUserId(): string | null {
    return this.session?.userId ?? null;
  }

  /** The user as last loaded by `getMe()`, or null (signed out, or not loaded yet). */
  get currentUser(): RiviumUser | null {
    return this.session && this.user?.id === this.session.userId ? this.user : null;
  }

  get isSignedIn(): boolean {
    return this.session !== null;
  }

  /**
   * Calls `listener` with the user id now (once the stored session is loaded) and on every sign-in or sign-out.
   * Returns a function that stops listening.
   */
  onAuthStateChanged(listener: AuthStateListener): () => void {
    const entry = { last: undefined as string | null | undefined };
    this.listeners.set(listener, entry);
    void this.readyPromise.then(() => {
      if (this.listeners.get(listener) === entry) this.deliver(listener, entry, this.currentUserId);
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Tokens ────────────────────────────────────────────────────────────────────────────────────

  /**
   * A valid access token, refreshed when it is within 2 minutes of expiry, or null when signed out. Calls made at the
   * same time share one refresh. A network failure keeps the session (and rejects if the token has run out); a
   * revoked or expired session signs the user out and resolves null.
   */
  async getToken(options: { forceRefresh?: boolean } = {}): Promise<string | null> {
    await this.readyPromise;
    const s = this.session;
    if (!s) return null;
    if (!options.forceRefresh && s.accessToken && this.now() < s.accessExpiresAt - REFRESH_MARGIN_MS) {
      return s.accessToken;
    }
    return this.refresh();
  }

  /**
   * For Rivium Chat: `tokenProvider: auth.tokenProvider`. Resolves to a fresh access token and rejects with
   * `UNAUTHENTICATED` when nobody is signed in. Rivium Sync, Push and A/B Testing accept null while signed out: give
   * them `() => auth.getToken()` instead.
   */
  readonly tokenProvider: RiviumTokenProvider = async () => {
    const token = await this.getToken();
    if (!token) throw new RiviumAuthError('UNAUTHENTICATED', 'No user is signed in', 401);
    return token;
  };

  /** A fresh nonce for an Apple or Google sign-in. */
  createNonce(): Promise<SignInNonce> {
    return createNonce();
  }

  // ── Methods ───────────────────────────────────────────────────────────────────────────────────

  /** The sign-in methods this project offers (show only these). */
  getMethods(): Promise<RiviumAuthMethods> {
    return this.request<RiviumAuthMethods>('GET', '/v1/methods');
  }

  async signInAnonymously(): Promise<SignInResult> {
    return this.signIn(await this.request<ServerTokens>('POST', '/v1/anonymous'));
  }

  async signInWithApple(input: AppleSignInInput): Promise<SignInResult> {
    const body = { idToken: input.idToken, nonce: input.rawNonce, authorizationCode: input.authorizationCode, name: input.name };
    const res = await this.request<ServerTokens & { created?: boolean }>('POST', '/v1/apple', body);
    return { ...(await this.signIn(res)), created: !!res.created };
  }

  async signInWithGoogle(input: GoogleSignInInput): Promise<SignInResult> {
    const res = await this.request<ServerTokens & { created?: boolean }>('POST', '/v1/google', { idToken: input.idToken, nonce: input.rawNonce });
    return { ...(await this.signIn(res)), created: !!res.created };
  }

  /** Adds Apple to the signed-in (often anonymous) user; the user id stays the same. `PROVIDER_ALREADY_LINKED` if another user has it. */
  async linkApple(input: AppleSignInInput): Promise<SignInResult> {
    const body = { idToken: input.idToken, nonce: input.rawNonce, authorizationCode: input.authorizationCode, name: input.name };
    return this.signIn(await this.authed<ServerTokens>('POST', '/v1/link/apple', body));
  }

  /** Adds Google to the signed-in user. `PROVIDER_ALREADY_LINKED` if another user has it. */
  async linkGoogle(input: GoogleSignInInput): Promise<SignInResult> {
    return this.signIn(await this.authed<ServerTokens>('POST', '/v1/link/google', { idToken: input.idToken, nonce: input.rawNonce }));
  }

  /** Gives the signed-in (often anonymous) user an e-mail and password, keeping its id. */
  async linkPassword(input: EmailPasswordInput): Promise<SignInResult> {
    return this.signIn(await this.authed<ServerTokens>('POST', '/v1/link/password', { email: input.email, password: input.password }));
  }

  /**
   * Creates an e-mail + password account. Pass `redirectUrl` (one of the project's allowed redirect URLs) to send a
   * verification e-mail. If the project requires a verified e-mail, the user is not signed in yet (`signedIn: false`).
   */
  async signUpWithEmail(input: EmailPasswordInput & { redirectUrl?: string }): Promise<SignUpResult> {
    const res = await this.request<{ userId: string; verificationSent: boolean; session: ServerTokens | null }>(
      'POST',
      '/v1/password/sign-up',
      { email: input.email, password: input.password, redirectUrl: input.redirectUrl },
    );
    if (res.session) await this.signIn(res.session);
    return { userId: res.userId, verificationSent: !!res.verificationSent, signedIn: !!res.session };
  }

  async signInWithEmail(input: EmailPasswordInput): Promise<SignInResult> {
    return this.signIn(await this.request<ServerTokens>('POST', '/v1/password/sign-in', { email: input.email, password: input.password }));
  }

  /** Sends a reset link to `redirectUrl?token=…`. Answers the same whether or not the address has an account. */
  async sendPasswordReset(input: { email: string; redirectUrl: string }): Promise<void> {
    await this.request('POST', '/v1/password/forgot', { email: input.email, redirectUrl: input.redirectUrl });
  }

  /** Sets a new password with the token from the reset link. Ends every session; the user then signs in. */
  async resetPassword(input: { token: string; password: string }): Promise<void> {
    await this.request('POST', '/v1/password/reset', { token: input.token, password: input.password });
  }

  /** Confirms the e-mail with the token from the verification link. */
  async verifyEmail(input: { token: string }): Promise<void> {
    await this.request('POST', '/v1/email/verify', { token: input.token });
  }

  /** Sends the signed-in user a new verification e-mail. */
  async sendEmailVerification(input: { redirectUrl: string }): Promise<void> {
    await this.authed('POST', '/v1/email/send-verification', { redirectUrl: input.redirectUrl });
  }

  /** E-mails a sign-in link to `redirectUrl?token=…`. The account is created on first use. */
  async sendMagicLink(input: { email: string; redirectUrl: string }): Promise<void> {
    await this.request('POST', '/v1/magic-link/send', { email: input.email, redirectUrl: input.redirectUrl });
  }

  /** Signs in with the token from a magic link. */
  async signInWithMagicLink(input: { token: string }): Promise<SignInResult> {
    return this.signIn(await this.request<ServerTokens>('POST', '/v1/magic-link/consume', { token: input.token }));
  }

  /** Sends a 6-digit code to the user's Telegram. `phone` in international format, e.g. `+37491234567`. */
  requestTelegramCode(input: { phone: string }): Promise<TelegramCodeResult> {
    return this.request<TelegramCodeResult>('POST', '/v1/telegram/code', { phone: input.phone });
  }

  async verifyTelegramCode(input: { phone: string; code: string }): Promise<SignInResult> {
    return this.signIn(await this.request<ServerTokens>('POST', '/v1/telegram/verify', { phone: input.phone, code: input.code }));
  }

  // ── Account ───────────────────────────────────────────────────────────────────────────────────

  /** Loads the signed-in user from the server (and updates `currentUser`). */
  async getMe(): Promise<RiviumUser> {
    const generation = this.generation;
    const me = await this.authed<RiviumUser>('GET', '/v1/me');
    if (generation === this.generation || this.session?.userId === me.id) this.user = me;
    return me;
  }

  /** Ends this session, on this device. Never fails: the local session is always cleared. */
  async signOut(): Promise<void> {
    await this.readyPromise;
    const s = this.session;
    await this.clearSession();
    if (!s) return;
    try {
      await this.request('POST', '/v1/sign-out', { refreshToken: s.refreshToken });
    } catch {
      // The local session is gone either way; the server session ends on its own.
    }
  }

  /** Ends every session of this user, on every device. */
  async signOutEverywhere(): Promise<void> {
    await this.authed('POST', '/v1/sign-out-everywhere');
    await this.clearSession();
  }

  /** Deletes the user and all their sign-in data, then signs out. */
  async deleteAccount(): Promise<void> {
    await this.authed('DELETE', '/v1/me');
    await this.clearSession();
  }

  // ── Internals ─────────────────────────────────────────────────────────────────────────────────

  private async restore(): Promise<void> {
    const stored = await this.readStored();
    if (stored && !this.session) {
      this.session = { accessToken: null, accessExpiresAt: 0, refreshToken: stored.refreshToken, userId: stored.userId };
    }
    this.emit();
  }

  private async readStored(): Promise<Stored | null> {
    try {
      const raw = await this.storage.get(this.storageKey);
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (v && typeof v.refreshToken === 'string' && typeof v.userId === 'string') return { refreshToken: v.refreshToken, userId: v.userId };
    } catch {
      // Unreadable storage counts as signed out.
    }
    return null;
  }

  private async writeStored(value: Stored | null): Promise<void> {
    try {
      if (value) await this.storage.set(this.storageKey, JSON.stringify(value));
      else await this.storage.remove(this.storageKey);
    } catch {
      // Storage failures never break sign-in; the session simply may not survive a restart.
    }
  }

  private async signIn(tokens: ServerTokens): Promise<SignInResult> {
    await this.setSession(tokens);
    return { userId: tokens.userId };
  }

  private async setSession(t: ServerTokens): Promise<void> {
    if (!t || typeof t.accessToken !== 'string' || typeof t.refreshToken !== 'string' || typeof t.userId !== 'string') {
      throw new RiviumAuthError('UNKNOWN', 'Unexpected answer from Rivium Auth');
    }
    const expiresIn = typeof t.expiresIn === 'number' && t.expiresIn > 0 ? t.expiresIn : 3600;
    if (this.session?.userId !== t.userId) this.user = null;
    this.generation++;
    this.session = { accessToken: t.accessToken, accessExpiresAt: this.now() + expiresIn * 1000, refreshToken: t.refreshToken, userId: t.userId };
    await this.writeStored({ refreshToken: t.refreshToken, userId: t.userId });
    this.emit();
  }

  private async clearSession(): Promise<void> {
    this.generation++;
    this.session = null;
    this.user = null;
    await this.writeStored(null);
    this.emit();
  }

  private refresh(): Promise<string | null> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  /** The current access token if it has not run out yet. */
  private validAccessToken(): string | null {
    const s = this.session;
    return s?.accessToken && this.now() < s.accessExpiresAt ? s.accessToken : null;
  }

  private async doRefresh(): Promise<string | null> {
    const generation = this.generation;
    const s = this.session;
    if (!s) return null;
    let sent = s.refreshToken;
    // Another tab or instance sharing this storage may have rotated the token already.
    const stored = await this.readStored();
    if (generation !== this.generation) return this.validAccessToken();
    if (stored && stored.userId === s.userId && stored.refreshToken !== sent) sent = stored.refreshToken;

    try {
      let tokens: ServerTokens;
      try {
        tokens = await this.request<ServerTokens>('POST', '/v1/token/refresh', { refreshToken: sent });
      } catch (err) {
        if (!isRiviumAuthError(err) || err.code !== 'TOKEN_INVALID') throw err;
        const again = await this.readStored();
        if (!again || again.refreshToken === sent || again.userId !== s.userId || generation !== this.generation) throw err;
        tokens = await this.request<ServerTokens>('POST', '/v1/token/refresh', { refreshToken: again.refreshToken });
      }
      if (generation !== this.generation) return this.validAccessToken();
      await this.setSession(tokens);
      return tokens.accessToken;
    } catch (err) {
      if (generation !== this.generation) return this.validAccessToken();
      if (isRiviumAuthError(err) && SESSION_ENDED_CODES.has(err.code)) {
        await this.clearSession();
        return null;
      }
      // Offline, rate-limited, over a plan limit: the session stays. Use the token while it lasts.
      const still = this.validAccessToken();
      if (still) return still;
      throw err;
    }
  }

  /** A request on behalf of the signed-in user; one retry with a fresh token if the server rejects the old one. */
  private async authed<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.getToken();
    if (!token) throw new RiviumAuthError('UNAUTHENTICATED', 'No user is signed in', 401);
    try {
      return await this.request<T>(method, path, body, token);
    } catch (err) {
      if (isRiviumAuthError(err) && err.status === 401 && (err.code === 'UNAUTHENTICATED' || err.code === 'TOKEN_INVALID')) {
        const fresh = await this.getToken({ forceRefresh: true });
        if (fresh && fresh !== token) return this.request<T>(method, path, body, fresh);
      }
      throw err;
    }
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown, bearer?: string): Promise<T> {
    const headers: Record<string, string> = { 'x-api-key': this.apiKey, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (bearer) headers.Authorization = `Bearer ${bearer}`;

    const AC = (globalThis as { AbortController?: new () => { signal: unknown; abort(): void } }).AbortController;
    const controller = AC ? new AC() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
    let status: number;
    let ok: boolean;
    let text: string;
    let retryAfter: string | null;
    try {
      const res = await this.fetchFn(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller?.signal,
      });
      status = res.status;
      ok = res.ok;
      retryAfter = res.headers?.get?.('retry-after') ?? null;
      text = await res.text();
    } catch (err) {
      throw new RiviumAuthError('NETWORK_ERROR', 'Could not reach Rivium Auth', 0, { cause: String(err) });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    if (!ok) {
      const { code, message, ...rest } = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
      if (rest.retryAfterSec === undefined && retryAfter && !Number.isNaN(Number(retryAfter))) rest.retryAfterSec = Number(retryAfter);
      const errorCode = typeof code === 'string' ? (code as RiviumAuthError['code']) : status >= 500 ? 'INTERNAL' : 'UNKNOWN';
      throw new RiviumAuthError(errorCode, typeof message === 'string' ? message : `Request failed (${status})`, status, rest);
    }
    return json as T;
  }

  private emit(): void {
    const id = this.currentUserId;
    for (const [listener, entry] of [...this.listeners]) this.deliver(listener, entry, id);
  }

  private deliver(listener: AuthStateListener, entry: { last: string | null | undefined }, id: string | null): void {
    if (entry.last === id) return;
    entry.last = id;
    try {
      listener(id);
    } catch {
      // A failing listener must not break the SDK.
    }
  }
}

/** Creates the Rivium Auth client. */
export function createRiviumAuth(config: RiviumAuthConfig): RiviumAuth {
  return new RiviumAuth(config);
}
