import { RiviumAuthError } from './errors';
import { sha256Hex, toHex } from './sha256';

/** A sign-in nonce: give `hashedNonce` to Apple / Google, and `rawNonce` to Rivium Auth. */
export interface SignInNonce {
  rawNonce: string;
  hashedNonce: string;
}

/**
 * Creates a fresh nonce for one Apple or Google sign-in. Pass `hashedNonce` to the provider's sign-in call (it ends
 * up inside the ID token) and `rawNonce` to `signInWithApple` / `signInWithGoogle`. Each nonce works once.
 *
 * Needs `crypto.getRandomValues` (all browsers; on React Native install `react-native-get-random-values` or use
 * Expo's `expo-crypto` polyfill).
 */
export async function createNonce(): Promise<SignInNonce> {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new RiviumAuthError(
      'NOT_CONFIGURED',
      'crypto.getRandomValues is not available. On React Native, import "react-native-get-random-values" first.',
    );
  }
  const bytes = new Uint8Array(32);
  c.getRandomValues(bytes);
  const rawNonce = toHex(bytes);
  return { rawNonce, hashedNonce: await sha256Hex(rawNonce) };
}
