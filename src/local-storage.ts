import type { RiviumAuthStorage } from './storage';

/**
 * Keeps the refresh token in `window.localStorage` so the user stays signed in after a reload.
 *
 * Opt-in on purpose: any script running on your page (an XSS bug, a compromised dependency) can read localStorage
 * and take the session with it. Use it only on a site with a strict Content Security Policy and no untrusted
 * scripts. The default (memory) is safer: the user signs in again after a reload.
 */
export function localStorageStorage(): RiviumAuthStorage {
  const ls = (): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } | null => {
    try {
      return (globalThis as { localStorage?: any }).localStorage ?? null;
    } catch {
      return null; // e.g. blocked by the browser's privacy settings
    }
  };
  return {
    async get(key) {
      try {
        return ls()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      ls()?.setItem(key, value);
    },
    async remove(key) {
      ls()?.removeItem(key);
    },
  };
}
