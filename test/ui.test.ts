// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RiviumAuth } from '../src/client';
import { MemoryStorage } from '../src/storage';
import { sha256Hex } from '../src/sha256';
import type { FetchLike } from '../src/types';
import { mountSignIn, openSignIn } from '../src/ui';

const BASE = 'https://auth.example.test';
type Reply = { status: number; body?: unknown };

/** A fake Rivium Auth server for the sign-in screens. */
function fake(methods: string[], answers: Record<string, (body: any) => Reply> = {}) {
  let n = 0;
  const calls: { path: string; body: any; headers: Record<string, string> }[] = [];
  const session = (userId: string) => ({ accessToken: `access_${++n}`, expiresIn: 3600, refreshToken: `refresh_${n}_xxxxxxxxxxxxxxxxxxxx`, userId });
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace(BASE, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, body, headers: init.headers });
    let r: Reply;
    if (path === '/v1/methods') r = { status: 200, body: { methods, telegramBot: null } };
    else if (path === '/v1/me') r = { status: 200, body: { id: 'u1', anonymous: false, emailVerified: true, createdAt: '2026-11-08T00:00:00Z', providers: ['password'] } };
    else if (answers[path]) r = answers[path](body);
    else r = { status: 404, body: { code: 'NOT_FOUND', message: 'no' } };
    return { ok: r.status < 300, status: r.status, headers: { get: () => null }, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)), json: async () => r.body } as any;
  };
  const auth = new RiviumAuth({ apiKey: 'rv_live_test', baseUrl: BASE, storage: new MemoryStorage(), fetch });
  return { auth, calls, session, bodies: (p: string) => calls.filter((c) => c.path === p).map((c) => c.body) };
}

const err = (code: string, status: number): Reply => ({ status, body: { code, message: 'hint for developers' } });

let target: HTMLElement;
afterEach(() => document.body.replaceChildren());

function mount(auth: RiviumAuth, options: Parameters<typeof mountSignIn>[2] = {}) {
  target = document.createElement('div');
  document.body.append(target);
  const signedIn: unknown[] = [];
  mountSignIn(target, auth, { ...options, onSignedIn: (r) => signedIn.push(r) });
  return signedIn;
}

const shadow = () => (document.querySelector('[data-rivium-sign-in]') ?? target.firstElementChild)!.shadowRoot!;
const el = (k: string) => shadow().querySelector<HTMLElement>(`[data-k="${k}"]`);
const has = (k: string) => el(k) !== null;
const text = () => shadow().textContent ?? '';
const settle = () => vi.waitFor(() => expect(shadow().querySelector('[data-view="loading"]')).toBeNull());
async function type(k: string, value: string) {
  const i = el(k) as HTMLInputElement;
  i.value = value;
  i.dispatchEvent(new Event('input', { bubbles: true }));
}
async function click(k: string) {
  el(k)!.click();
  await new Promise((r) => setTimeout(r, 0));
  await vi.waitFor(() => expect(shadow().querySelector('[aria-busy="true"]')).toBeNull());
}

describe('sign-in screens (web)', () => {
  it('shows only the methods that are on and that the app can run; guest only when asked', async () => {
    const { auth } = fake(['anonymous', 'google', 'password', 'magicLink', 'telegram']);
    mount(auth);
    await settle();
    expect(has('email')).toBe(true);
    expect(has('telegram')).toBe(true);
    expect(has('google')).toBe(false); // no google function given
    expect(has('magic-link')).toBe(false); // no magicLinkRedirectUrl
    expect(has('guest')).toBe(false); // allowGuest not set: a guest is a new (counted) user
    document.body.replaceChildren();
    mount(auth, { allowGuest: true });
    await settle();
    expect(has('guest')).toBe(true);
  });

  it('e-mail sign-in: checks the fields, then signs in', async () => {
    const f = fake(['password'], { '/v1/password/sign-in': () => ({ status: 200, body: f.session('u1') }) });
    const signedIn = mount(f.auth);
    await settle();
    await click('sign-in');
    expect(text()).toContain('Required');
    expect(f.bodies('/v1/password/sign-in')).toEqual([]);
    await type('email', ' ali@example.com ');
    await type('password', 'a-good-password');
    await click('sign-in');
    expect(f.bodies('/v1/password/sign-in')).toEqual([{ email: 'ali@example.com', password: 'a-good-password' }]);
    expect(signedIn).toEqual([{ userId: 'u1' }]);
    expect(f.auth.isSignedIn).toBe(true);
  });

  it('wrong password: a message from the code, never the server hint', async () => {
    const f = fake(['password'], { '/v1/password/sign-in': () => err('INVALID_CREDENTIALS', 401) });
    const signedIn = mount(f.auth);
    await settle();
    await type('email', 'ali@example.com');
    await type('password', 'wrong');
    await click('sign-in');
    expect(el('error')?.textContent).toBe('Wrong e-mail or password.');
    expect(text()).not.toContain('hint for developers');
    expect(signedIn).toEqual([]);
  });


  it('a language the screen does not have, or an odd code, shows English', async () => {
    for (const code of ['de', 'constructor', '__proto__', '']) {
      const f = fake(['password']);
      mount(f.auth, { languageCode: code });
      await settle();
      expect(text()).toContain('Sign in');
      expect(shadow().querySelector('.rivium')?.getAttribute('dir')).toBe('ltr');
    }
  });

  it('keeps a language the app set for the e-mails', async () => {
    const f = fake(['password']);
    f.auth.languageCode = 'de';
    mount(f.auth, { languageCode: 'en' });
    await settle();
    expect(f.auth.languageCode).toBe('de');
  });

  it('sign-up that needs a confirmed e-mail: link to Rivium’s confirm page', async () => {
    const f = fake(['password'], { '/v1/password/sign-up': () => ({ status: 200, body: { userId: 'u9', verificationSent: true, session: null } }) });
    const signedIn = mount(f.auth);
    await settle();
    await click('to-sign-up');
    await type('sign-up-email', 'new@example.com');
    await type('sign-up-password', 'a-good-password');
    await click('sign-up');
    expect(f.bodies('/v1/password/sign-up')[0].redirectUrl).toBe(`${BASE}/pages/verify`);
    expect(el('sent')?.textContent).toContain('new@example.com');
    expect(signedIn).toEqual([]);
  });

  it('forgot password: no URL unless the app gives one (the server picks its page)', async () => {
    const f = fake(['password'], { '/v1/password/forgot': () => ({ status: 202 }) });
    mount(f.auth);
    await settle();
    await type('email', 'ali@example.com');
    await click('forgot');
    await click('forgot-send');
    expect(f.bodies('/v1/password/forgot')).toEqual([{ email: 'ali@example.com' }]);
    expect(text()).toContain('choose a new password');
  });

  it('magic link uses the app’s URL and checks the address', async () => {
    const f = fake(['magicLink'], { '/v1/magic-link/send': () => ({ status: 202 }) });
    mount(f.auth, { magicLinkRedirectUrl: 'https://app.example.com/auth' });
    await settle();
    await click('magic-link');
    await type('magicLink-email', 'nope');
    await click('magicLink-send');
    expect(text()).toContain('Enter a valid e-mail');
    await type('magicLink-email', 'ali@example.com');
    await click('magicLink-send');
    expect(f.bodies('/v1/magic-link/send')).toEqual([{ email: 'ali@example.com', redirectUrl: 'https://app.example.com/auth' }]);
  });

  it('Telegram: bot first (only an https://t.me link), then the code', async () => {
    let sent = false;
    let bot = 'javascript:alert(1)';
    const f = fake(['telegram'], {
      '/v1/telegram/code': () => ({ status: 200, body: sent ? { sent: true, expiresIn: 300 } : { sent: false, botUrl: bot, expiresIn: 0 } }),
      '/v1/telegram/verify': (b) => (b.code === '123456' ? { status: 200, body: f.session('u1') } : err('TOKEN_INVALID', 400)),
    });
    const signedIn = mount(f.auth);
    await settle();
    await click('telegram');
    await type('phone', '+98 912 345-6789');
    await click('send-code');
    expect(f.bodies('/v1/telegram/code')[0]).toEqual({ phone: '+989123456789' });
    expect(text()).not.toContain('javascript');
    expect(has('bot-link')).toBe(false);
    bot = 'https://t.me/tikashop_bot';
    await click('send-code');
    expect(el('bot-link')?.getAttribute('href')).toBe('https://t.me/tikashop_bot');
    expect(el('bot-link')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(el('bot-first')?.textContent).toContain('@tikashop_bot');
    sent = true;
    await click('send-code');
    await type('code', '000000');
    await click('verify-code');
    expect(el('error')?.textContent).toBe('This code is wrong or has expired.');
    await type('code', '123456');
    await click('verify-code');
    expect(signedIn).toEqual([{ userId: 'u1' }]);
  });

  it('Google: the app gets the hashed nonce, Rivium the raw one; cancel sends nothing', async () => {
    const f = fake(['google'], { '/v1/google': () => ({ status: 200, body: f.session('u1') }) });
    let hashed = '';
    let answer: string | null = null;
    const signedIn = mount(f.auth, { google: async (h) => ((hashed = h), answer) });
    await settle();
    await click('google');
    expect(f.bodies('/v1/google')).toEqual([]);
    expect(has('error')).toBe(false);
    answer = 'google-id-token';
    await click('google');
    const body = f.bodies('/v1/google')[0];
    expect(body.idToken).toBe('google-id-token');
    expect(await sha256Hex(body.nonce)).toBe(hashed);
    expect(signedIn).toEqual([{ userId: 'u1', created: false }]);
  });

  it('text from the server or the user is never read as HTML', async () => {
    const f = fake(['password', 'magicLink'], { '/v1/magic-link/send': () => ({ status: 202 }) });
    mount(f.auth, { appName: '<img src=x onerror=alert(1)>', magicLinkRedirectUrl: 'https://app.example.com/auth' });
    await settle();
    expect(shadow().querySelector('img[src="x"]')).toBeNull();
    await click('magic-link');
    await type('magicLink-email', '<b>x</b>@example.com');
    await click('magicLink-send');
    expect(shadow().querySelector('b')).toBeNull();
  });

  it('no answer from the server: a retry screen', async () => {
    const auth = new RiviumAuth({ apiKey: 'rv_live_test', baseUrl: BASE, storage: new MemoryStorage(), fetch: async () => { throw new TypeError('offline'); } });
    mount(auth);
    await settle();
    expect(el('unavailable')?.textContent).toContain('No connection');
    expect(has('retry')).toBe(true);
  });

  it('the app’s page CSS does not reach the form (shadow root)', async () => {
    const f = fake(['password']);
    mount(f.auth);
    await settle();
    expect(document.querySelector('[data-k="email"]')).toBeNull(); // not in the page's own DOM
    expect(has('email')).toBe(true);
  });
});

describe('openSignIn', () => {
  it('a dialog that answers the signed-in user and removes itself', async () => {
    const f = fake(['anonymous'], { '/v1/anonymous': () => ({ status: 200, body: f.session('guest-1') }) });
    const result = openSignIn(f.auth, { allowGuest: true });
    expect(shadow().querySelector('dialog')?.hasAttribute('open')).toBe(true);
    await settle();
    await click('guest');
    expect(await result).toEqual({ userId: 'guest-1' });
    expect(document.querySelector('[data-rivium-sign-in]')).toBeNull();
  });

  it('closing answers null and signs no one in', async () => {
    const f = fake(['anonymous']);
    const result = openSignIn(f.auth, { allowGuest: true });
    await settle();
    el('close')!.click();
    expect(await result).toBeNull();
    expect(f.bodies('/v1/anonymous')).toEqual([]);
    expect(document.querySelector('[data-rivium-sign-in]')).toBeNull();
  });

  it('Esc closes it too', async () => {
    const f = fake(['password']);
    const result = openSignIn(f.auth);
    await settle();
    shadow().querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(await result).toBeNull();
  });
});

describe('the CommonJS build', () => {
  it('shows the right message for an error thrown by the main entry (another copy of the error class)', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const main = require('../dist/index.js');
    const ui = require('../dist/ui.js');
    const fetch: FetchLike = async (url) => {
      const path = url.replace(BASE, '');
      const r = path === '/v1/methods' ? { status: 200, body: { methods: ['password'], telegramBot: null } } : err('INVALID_CREDENTIALS', 401);
      return { ok: r.status < 300, status: r.status, headers: { get: () => null }, text: async () => JSON.stringify(r.body), json: async () => r.body } as any;
    };
    const auth = new main.RiviumAuth({ apiKey: 'rv_live_test', baseUrl: BASE, storage: new main.MemoryStorage(), fetch });
    target = document.createElement('div');
    document.body.append(target);
    ui.mountSignIn(target, auth, {});
    await settle();
    await type('email', 'ali@example.com');
    await type('password', 'wrong');
    await click('sign-in');
    expect(el('error')?.textContent).toBe('Wrong e-mail or password.');
  });
});

describe('the e-mail language', () => {
  it('follows the open screen, is given back on close, and never replaces the app’s own choice', async () => {
    const f = fake(['password']);
    const m = mountSignIn(document.body.appendChild(document.createElement('div')), f.auth, { languageCode: 'en' });
    target = document.body.lastElementChild as HTMLElement;
    await settle();
    expect(f.auth.languageCode).toBe('en');
    m.destroy();
    expect(f.auth.languageCode).toBeNull();
    f.auth.languageCode = 'en-US'; // the app chooses
    mount(f.auth, { languageCode: 'en' });
    await settle();
    expect(f.auth.languageCode).toBe('en-US');
  });
});

describe('the e-mail language with two screens', () => {
  it('a screen closing while another is open does not take the language away', async () => {
    const f = fake(['password']);
    const a = mountSignIn(document.body.appendChild(document.createElement('div')), f.auth, { languageCode: 'en' });
    const b = mountSignIn(document.body.appendChild(document.createElement('div')), f.auth, { languageCode: 'en' });
    await new Promise((r) => setTimeout(r, 20));
    a.destroy();
    expect(f.auth.languageCode).toBe('en');
    b.destroy();
    expect(f.auth.languageCode).toBeNull();
  });
});

describe('security review fixes', () => {
  it('sign-up that needs a confirmed e-mail but sent none: says so, never "check your e-mail"', async () => {
    const f = fake(['password'], { '/v1/password/sign-up': () => ({ status: 200, body: { userId: 'u9', verificationSent: false, session: null } }) });
    mount(f.auth);
    await settle();
    await click('to-sign-up');
    await type('sign-up-email', 'new@example.com');
    await type('sign-up-password', 'a-good-password');
    await click('sign-up');
    expect(has('sent')).toBe(false);
    expect(el('error')?.textContent).toContain('could not be sent');
    expect((el('password') as HTMLInputElement).value).toBe(''); // the password is not kept
  });

  it('the password is not kept after a sign-up that waits for the e-mail', async () => {
    const f = fake(['password'], { '/v1/password/sign-up': () => ({ status: 200, body: { userId: 'u9', verificationSent: true, session: null } }) });
    mount(f.auth);
    await settle();
    await click('to-sign-up');
    await type('sign-up-email', 'new@example.com');
    await type('sign-up-password', 'a-good-password');
    await click('sign-up');
    await click('back-home');
    expect((el('password') as HTMLInputElement).value).toBe('');
  });

  it('the dialog cannot be closed while a sign-in runs; it answers the user', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = fake(['anonymous']);
    const slow = fake(['anonymous'], {
      '/v1/anonymous': () => ({ status: 200, body: f.session('guest-1') }),
    });
    const fetchSlow: FetchLike = async (url, init) => {
      if (url.endsWith('/v1/anonymous')) await gate;
      return (slow.auth as any).fetchFn(url, init);
    };
    const auth = new RiviumAuth({ apiKey: 'rv_live_test', baseUrl: BASE, storage: new MemoryStorage(), fetch: fetchSlow });
    const result = openSignIn(auth, { allowGuest: true });
    await settle();
    el('guest')!.click();
    await vi.waitFor(() => expect(el('guest')?.hasAttribute('disabled')).toBe(true));
    el('close')!.click();
    shadow().querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(document.querySelector('[data-rivium-sign-in]')).not.toBeNull(); // still open
    release();
    expect(await result).toEqual({ userId: 'guest-1' });
  });
});
