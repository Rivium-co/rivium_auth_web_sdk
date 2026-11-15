## [0.5.0] - 2026-11-16

- `resendVerification({ email, password })`: when your project requires a confirmed e-mail, someone who can't sign in
  yet (`EMAIL_NOT_VERIFIED`) gets the confirmation link again. The e-mail and password prove the account; a wrong pair
  fails like signing in. Nothing is sent to an account that is already confirmed.
- `continueUrl` on `signUpWithEmail`, `sendEmailVerification`, `sendPasswordReset` and `resendVerification`, like
  Firebase's continue URL: Rivium's own confirm and reset pages show a "Continue" button to it when they are done. It
  must be one of your project's link addresses.
- `sendEmailVerification`: `redirectUrl` is optional; without it the link opens Rivium's own confirm page.
- Sign-in screens: "Send again" when signing in fails because the e-mail isn't confirmed yet, and a `continueUrl`
  option.

## [0.2.0] - 2026-11-05

- `getTokenResult({ forceRefresh })`: the access token with its decoded fields, like Firebase's
  `getIdTokenResult()`. `claims` holds the custom claims your server set with `setCustomUserClaims`, at the top level
  (for example `plan`, `role`), plus `sub`, `iat`, `exp`, `auth_time` and `amr`; also `expirationTime`,
  `issuedAtTime`, `authTime` and `signInProvider`. For showing things in the app; access is still decided on the
  server. Pass `{ forceRefresh: true }` right after your server changed the claims.
- `decodeTokenPayload(token)` helper.

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
