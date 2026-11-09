/** The sign-in screens' texts: English, and each language in LANGUAGES (the same texts as the Flutter SDK). */

/** A language code the screens have a table for (see LANGUAGES); English for any other. */
export type UiLanguage = string;

/** One language of the screens. */
export interface UiTable {
  rtl: boolean;
  texts: Record<string, string>;
}

const en: Record<string, string> = {
  "title": "Sign in",
  "titleTo": "Sign in to {app}",
  "signUpTitle": "Create an account",
  "forgotTitle": "Reset your password",
  "magicTitle": "Sign in with a link",
  "telegramTitle": "Sign in with Telegram",
  "email": "E-mail",
  "password": "Password",
  "phone": "Phone number",
  "phoneHint": "+98 912 345 6789",
  "code": "Code",
  "signIn": "Sign in",
  "signUp": "Create account",
  "noAccount": "No account? Create one",
  "haveAccount": "Have an account? Sign in",
  "forgot": "Forgot password?",
  "sendReset": "Send reset link",
  "sendLink": "Send sign-in link",
  "sendCode": "Send code",
  "verify": "Verify",
  "or": "or",
  "withEmailLink": "E-mail me a sign-in link",
  "withTelegram": "Continue with Telegram",
  "withGoogle": "Continue with Google",
  "withApple": "Continue with Apple",
  "guest": "Continue as guest",
  "back": "Back",
  "close": "Close",
  "retry": "Try again",
  "checkEmail": "Check your e-mail",
  "resetSent": "If {email} has an account, a link to choose a new password is on its way.",
  "linkSent": "We sent a sign-in link to {email}. Open it on this device.",
  "verifySent": "We sent a confirmation link to {email}. Confirm your e-mail, then sign in.",
  "codeSent": "Enter the code Telegram sent you.",
  "botFirst": "Open {bot} in Telegram once and share your phone number, then try again.",
  "noMethods": "Sign-in is not available right now.",
  "required": "Required",
  "badEmail": "Enter a valid e-mail",
  "error.INVALID_CREDENTIALS": "Wrong e-mail or password.",
  "error.EMAIL_TAKEN": "This e-mail already has an account. Sign in instead.",
  "error.EMAIL_NOT_VERIFIED": "Confirm your e-mail first. Check your inbox.",
  "error.WEAK_PASSWORD": "Choose a longer password that is not a common one.",
  "error.INVALID_INPUT": "Check what you entered.",
  "error.TOKEN_INVALID": "This code is wrong or has expired.",
  "error.RATE_LIMITED": "Too many tries. Wait a little and try again.",
  "error.USER_DISABLED": "This account is disabled.",
  "error.METHOD_DISABLED": "This sign-in method is turned off.",
  "error.PRODUCT_DISABLED": "Sign-in is not available right now.",
  "error.MAU_LIMIT": "Sign-in is not available right now.",
  "error.NETWORK_ERROR": "No connection. Check your internet and try again.",
  "error.PROVIDER_ALREADY_LINKED": "This account is linked to another user.",
  "error.INVALID_ID_TOKEN": "Sign-in could not be confirmed. Try again.",
  "error.VERIFY_NOT_SENT": "Your account was created, but the confirmation e-mail could not be sent. Try again later with “Forgot password?”.",
  "error.other": "Something went wrong. Try again.",
};


export interface UiStrings {
  lang: UiLanguage;
  rtl: boolean;
  t(key: string): string;
  /** The user-facing message for an error code. */
  error(code: string): string;
}

/** The languages of the screens, by the part of a language code before "-" or "_" ("en-US" → "en"). */
const LANGUAGES: Record<string, UiTable> = {
  en: { rtl: false, texts: en },
};

/** The table of `languageCode` when the screens have one, English for everything else. */
export function uiStrings(languageCode: string | null | undefined): UiStrings {
  const code = (languageCode ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  const lang: UiLanguage = Object.prototype.hasOwnProperty.call(LANGUAGES, code) ? code : 'en';
  const { rtl, texts: table } = LANGUAGES[lang]!;
  const t = (key: string) => table[key] ?? en[key] ?? key;
  return { lang, rtl, t, error: (code) => table[`error.${code}`] ?? en[`error.${code}`] ?? t('error.other') };
}
