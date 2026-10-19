## [0.1.1] - 2026-10-20

- Sends `X-Rivium-SDK: auth-web/0.1.1` with every request so Rivium can show which SDK versions are in use. No behaviour
  change.

## [0.1.0] - 2026-10-16

- Initial release: anonymous, Apple, Google, e-mail + password, magic link and Telegram sign-in; linking a method to
  the signed-in user; `getMe`, `signOut`, `signOutEverywhere`, `deleteAccount`.
- Sessions refresh themselves (one request for concurrent callers); rotated refresh tokens are saved.
- Works with the other Rivium SDKs: `() => auth.getToken()` for Rivium Sync, Push and A/B Testing (null while signed
  out), `auth.tokenProvider` for Rivium Chat (rejects while signed out).
- Memory storage by default; opt-in `localStorageStorage()`.
- Example app in `example/`.
