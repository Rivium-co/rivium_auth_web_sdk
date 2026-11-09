/**
 * `getTokenResult()`: the access token with its decoded fields, Firebase's `getIdTokenResult()` shape. Pure
 * JavaScript (no atob / TextDecoder), so it runs the same in browsers, React Native and Node.
 *
 * For display only (a "Pro" badge, unlocked lessons): the app can read a token but never change it. Rivium's
 * servers check the signature on every request and decide access with rules.
 */
import type { RiviumTokenResult } from './types';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url → bytes. */
function base64UrlBytes(input: string): number[] {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of input.replace(/=+$/, '')) {
    const v = B64.indexOf(ch === '+' ? '-' : ch === '/' ? '_' : ch);
    if (v < 0) throw new Error('not base64url');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
}

/** UTF-8 bytes → text (claims may hold any language). */
function utf8(bytes: number[]): string {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b < 0xe0) cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (b < 0xf0) cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    s += String.fromCodePoint(cp);
  }
  return s;
}

/** The payload of a JWT, or null when it isn't one. */
export function decodeTokenPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(utf8(base64UrlBytes(parts[1])));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isoOf = (seconds: unknown): string | null =>
  typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;

/** Builds the result from a token; null when the token can't be read. */
export function tokenResultOf(token: string): RiviumTokenResult | null {
  const payload = decodeTokenPayload(token);
  if (!payload) return null;
  // `meta` is Rivium's own bookkeeping for its servers, not a claim. Custom claims come at the top level; a server
  // that nests them under `claims` gets them spread out too (token fields always win over a custom claim).
  const { meta: _meta, claims: nested, ...fields } = payload;
  const claims: Record<string, unknown> = {
    ...(nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as Record<string, unknown>) : {}),
    ...fields,
  };
  const amr = Array.isArray(payload.amr) && typeof payload.amr[0] === 'string' ? (payload.amr[0] as string) : null;
  const expirationTime = isoOf(payload.exp);
  const issuedAtTime = isoOf(payload.iat);
  if (!expirationTime || !issuedAtTime) return null;
  return {
    token,
    claims,
    expirationTime,
    issuedAtTime,
    authTime: isoOf(payload.auth_time) ?? issuedAtTime,
    signInProvider: amr,
  };
}
