import type { RiviumAuth } from '../client';
import { isRiviumAuthError } from '../errors';
import type { RiviumAuthMethods, SignInResult } from '../types';
import type { SignInUiOptions } from './options';
import type { UiStrings } from './strings';

export type UiView = 'loading' | 'home' | 'signUp' | 'forgot' | 'magicLink' | 'telegramPhone' | 'telegramCode' | 'sent' | 'unavailable';
export type SentKind = 'reset' | 'magicLink' | 'verify';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The language the open sign-in screens set on a client, and how many are open: unset when the last one closes. */
const LANGUAGE_HOLDS = new WeakMap<RiviumAuth, { count: number; value: string }>();

const codeOf = (e: unknown): string => (isRiviumAuthError(e) ? e.code : 'UNKNOWN');

/** The sign-in screen's state and its SDK calls; the view only reads it and calls its methods. */
export class SignInController {
  view: UiView = 'loading';
  methods: RiviumAuthMethods = { methods: [], telegramBot: null };
  busy = false;
  /** The error code of the last failed action. */
  error: string | null = null;
  sent: SentKind | null = null;
  private botUrl: string | null = null;

  email = '';
  password = '';
  phone = '';
  code = '';
  emailError: string | null = null;
  passwordError: string | null = null;

  private closed = false;
  /** The screen set `auth.languageCode` (it was unset) and gives it back on close. */
  private languageSet = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly auth: RiviumAuth,
    readonly options: SignInUiOptions,
    readonly strings: UiStrings,
    private readonly onSignedIn: (result: SignInResult) => void,
  ) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get showPassword(): boolean {
    return this.methods.methods.includes('password');
  }
  get showMagicLink(): boolean {
    return this.methods.methods.includes('magicLink') && !!this.options.magicLinkRedirectUrl;
  }
  get showTelegram(): boolean {
    return this.methods.methods.includes('telegram');
  }
  get showGoogle(): boolean {
    return this.methods.methods.includes('google') && typeof this.options.google === 'function';
  }
  get showApple(): boolean {
    return this.methods.methods.includes('apple') && typeof this.options.apple === 'function';
  }
  /** Off unless the app asks: every guest is a new user and counts toward the plan's monthly users. */
  get showGuest(): boolean {
    return this.methods.methods.includes('anonymous') && this.options.allowGuest === true;
  }
  get hasOtherMethods(): boolean {
    return this.showMagicLink || this.showTelegram || this.showGoogle || this.showApple || this.showGuest;
  }
  get errorText(): string | null {
    return this.error ? this.strings.error(this.error) : null;
  }
  get title(): string {
    const app = (this.options.appName ?? '').trim();
    return app ? this.strings.t('titleTo').replace('{app}', app) : this.strings.t('title');
  }
  /** The Telegram bot link, only when it is an https://t.me address. */
  get safeBotUrl(): string | null {
    try {
      const u = new URL(this.botUrl ?? '');
      return u.protocol === 'https:' && u.hostname === 't.me' ? u.toString() : null;
    } catch {
      return null;
    }
  }

  async load(): Promise<void> {
    // While the screen is open, the e-mails follow its language, unless the app chose a language itself. Given
    // back when the screen closes.
    if (!this.languageSet) {
      const hold = LANGUAGE_HOLDS.get(this.auth);
      if (this.auth.languageCode == null || (hold && this.auth.languageCode === hold.value)) {
        this.auth.languageCode = this.strings.lang;
        LANGUAGE_HOLDS.set(this.auth, { count: (hold?.count ?? 0) + 1, value: this.strings.lang });
        this.languageSet = true;
      }
    }
    this.set({ view: 'loading' });
    try {
      this.methods = await this.auth.getMethods();
      this.error = null;
      this.set({ view: this.showPassword || this.hasOtherMethods ? 'home' : 'unavailable' });
    } catch (e) {
      this.error = codeOf(e);
      this.set({ view: 'unavailable' });
    }
  }

  go(view: UiView): void {
    this.error = null;
    this.emailError = null;
    this.passwordError = null;
    if (view === 'telegramPhone') {
      this.code = '';
      this.botUrl = null;
    }
    this.set({ view });
  }

  back(): void {
    this.go('home');
  }

  signIn = (): Promise<void> => this.withEmail(true, async () => this.done(await this.auth.signInWithEmail({ email: this.email.trim(), password: this.password })));

  signUp = (): Promise<void> =>
    this.withEmail(true, async () => {
      const r = await this.auth.signUpWithEmail({
        email: this.email.trim(),
        password: this.password,
        redirectUrl: this.options.verifyRedirectUrl ?? `${this.auth.baseUrl}/pages/verify`,
      });
      if (r.signedIn) return this.done({ userId: r.userId });
      this.password = '';
      if (!r.verificationSent) {
        // The account exists but must be confirmed, and no e-mail went out.
        this.error = 'VERIFY_NOT_SENT';
        return this.set({ view: 'home' });
      }
      this.sent = 'verify';
      this.set({ view: 'sent' });
    });

  sendReset = (): Promise<void> =>
    this.withEmail(false, async () => {
      await this.auth.sendPasswordReset({ email: this.email.trim(), redirectUrl: this.options.resetRedirectUrl }); // none: Rivium's reset page
      this.sent = 'reset';
      this.set({ view: 'sent' });
    });

  sendMagicLink = (): Promise<void> =>
    this.withEmail(false, async () => {
      await this.auth.sendMagicLink({ email: this.email.trim(), redirectUrl: this.options.magicLinkRedirectUrl! });
      this.sent = 'magicLink';
      this.set({ view: 'sent' });
    });

  sendTelegramCode = async (): Promise<void> => {
    if (!this.phone.trim()) {
      this.error = 'INVALID_INPUT';
      return this.set({});
    }
    await this.run(async () => {
      const r = await this.auth.requestTelegramCode({ phone: this.cleanPhone() });
      this.botUrl = r.sent ? null : (r.botUrl ?? null);
      if (r.sent) {
        this.code = '';
        this.set({ view: 'telegramCode' });
      }
    });
  };

  verifyTelegramCode = async (): Promise<void> => {
    if (!this.code.trim()) {
      this.error = 'INVALID_INPUT';
      return this.set({});
    }
    await this.run(async () => this.done(await this.auth.verifyTelegramCode({ phone: this.cleanPhone(), code: this.code.trim() })));
  };

  continueAsGuest = (): Promise<void> => this.run(async () => this.done(await this.auth.signInAnonymously()));

  continueWithGoogle = (): Promise<void> =>
    this.run(async () => {
      const nonce = await this.auth.createNonce();
      const idToken = await this.options.google!(nonce.hashedNonce);
      if (!idToken) return; // cancelled
      this.done(await this.auth.signInWithGoogle({ idToken, rawNonce: nonce.rawNonce }));
    });

  continueWithApple = (): Promise<void> =>
    this.run(async () => {
      const nonce = await this.auth.createNonce();
      const c = await this.options.apple!(nonce.hashedNonce);
      if (!c) return; // cancelled
      this.done(await this.auth.signInWithApple({ idToken: c.idToken, rawNonce: nonce.rawNonce, authorizationCode: c.authorizationCode, name: c.name }));
    });

  close(): void {
    this.closed = true;
    this.password = '';
    const hold = LANGUAGE_HOLDS.get(this.auth);
    if (this.languageSet && hold && --hold.count === 0) {
      LANGUAGE_HOLDS.delete(this.auth);
      if (this.auth.languageCode === hold.value) this.auth.languageCode = null;
    }
    this.listeners.clear();
  }

  private cleanPhone(): string {
    return this.phone.replace(/[\s\-()]/g, '');
  }

  private async withEmail(needPassword: boolean, action: () => Promise<void>): Promise<void> {
    const e = this.email.trim();
    this.emailError = !e ? this.strings.t('required') : EMAIL_SHAPE.test(e) ? null : this.strings.t('badEmail');
    this.passwordError = needPassword && !this.password ? this.strings.t('required') : null;
    this.error = null;
    if (this.emailError || this.passwordError) return this.set({});
    await this.run(action);
  }

  private done(result: SignInResult): void {
    this.password = '';
    if (!this.closed) this.onSignedIn(result);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.error = null;
    this.set({ busy: true });
    try {
      await action();
    } catch (e) {
      this.error = codeOf(e);
    } finally {
      this.set({ busy: false });
    }
  }

  private set(change: { view?: UiView; busy?: boolean }): void {
    if (this.closed) return;
    if (change.view) this.view = change.view;
    if (change.busy !== undefined) this.busy = change.busy;
    for (const l of this.listeners) l();
  }
}
