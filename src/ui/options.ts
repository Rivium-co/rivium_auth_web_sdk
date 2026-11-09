/** What Sign in with Apple returned. */
export interface AppleCredential {
  idToken: string;
  /** Lets Rivium revoke the Apple sign-in when the account is deleted. */
  authorizationCode?: string;
  /** The name Apple gives on the first sign-in only. */
  name?: string;
}

/** What the sign-in screen offers and how it looks. Every method also has to be on in the Console. */
export interface SignInUiOptions {
  /** Shown as "Sign in to {appName}". */
  appName?: string;
  /** An image URL shown above the title, for example your app icon. */
  logoUrl?: string;
  /** The screen's language, a code such as `en`. Default: the browser's language (English when the screen doesn't
   * have it). The e-mails follow it too, unless you set `auth.languageCode` yourself.
   */
  languageCode?: string;
  /** The button colour, for example `#1f6feb`. You can also set the CSS variable `--rivium-accent`. */
  color?: string;
  /** Shows "Continue as guest" when anonymous sign-in is on. Off by default: every guest is a new user and counts
   * toward the plan's monthly users. */
  allowGuest?: boolean;
  /** Gets a Google ID token for `hashedNonce` with Google Identity Services. Return null when the user cancels. */
  google?: (hashedNonce: string) => Promise<string | null>;
  /** Runs Sign in with Apple JS for `hashedNonce`. Return null when the user cancels. */
  apple?: (hashedNonce: string) => Promise<AppleCredential | null>;
  /** One of the project's allowed redirect URLs (a page of your site). Shows the magic link button; that page
   * finishes it with `auth.signInWithMagicLink({ token })`. */
  magicLinkRedirectUrl?: string;
  /** Where the confirm e-mail link goes. Default: Rivium's own confirm page. */
  verifyRedirectUrl?: string;
  /** Where the password reset link goes. Default: Rivium's own reset page. */
  resetRedirectUrl?: string;
}
