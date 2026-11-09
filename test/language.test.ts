import { describe, expect, it, vi } from 'vitest';
import { RiviumAuth } from '../src/client';
import type { FetchLike } from '../src/types';

function setup(config: { languageCode?: string | null } = {}) {
  const calls: { path: string; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = vi.fn(async (url, init) => {
    calls.push({ path: url.replace('https://auth-users.rivium.co', ''), headers: init.headers });
    return { ok: true, status: 202, headers: { get: () => null }, text: async () => '' };
  });
  const auth = new RiviumAuth({ apiKey: 'rv_live_test', fetch, ...config });
  return { auth, calls };
}
const send = (auth: RiviumAuth) => auth.sendMagicLink({ email: 'a@example.com', redirectUrl: 'https://app.example.com/magic' });

describe('languageCode (the e-mail language, like Firebase)', () => {
  it('is not sent until set: the project template language applies', async () => {
    const { auth, calls } = setup();
    expect(auth.languageCode).toBeNull();
    await send(auth);
    expect(calls[0].headers['x-rivium-locale']).toBeUndefined();
  });

  it('is sent as x-rivium-locale once set, from the config or later', async () => {
    const a = setup({ languageCode: 'de' });
    await send(a.auth);
    expect(a.calls[0].headers['x-rivium-locale']).toBe('de');
    a.auth.languageCode = 'en-US';
    await send(a.auth);
    expect(a.calls[1].headers['x-rivium-locale']).toBe('en-US');
    a.auth.languageCode = null;
    await send(a.auth);
    expect(a.calls[2].headers['x-rivium-locale']).toBeUndefined();
  });

  it('ignores values that are not a language tag', () => {
    const { auth } = setup();
    for (const bad of ['', '  ', 'de\r\nX: y', 'x'.repeat(40), '12']) {
      auth.languageCode = bad;
      expect(auth.languageCode).toBeNull();
    }
  });

  it("useDeviceLanguage() takes the browser's language", async () => {
    vi.stubGlobal('navigator', { language: 'de-AT' });
    const { auth, calls } = setup();
    auth.useDeviceLanguage();
    expect(auth.languageCode).toBe('de-AT');
    await send(auth);
    expect(calls[0].headers['x-rivium-locale']).toBe('de-AT');
    vi.unstubAllGlobals();
  });
});
