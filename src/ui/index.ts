import type { RiviumAuth } from '../client';
import type { SignInResult } from '../types';
import { SignInController } from './controller';
import type { SignInUiOptions } from './options';
import { uiStrings } from './strings';
import { STYLES } from './styles';
import { render } from './view';

export type { AppleCredential, SignInUiOptions } from './options';

/** A sign-in form placed with `mountSignIn`. */
export interface MountedSignIn {
  /** Removes the form. */
  destroy(): void;
}

function browserLanguage(): string | undefined {
  return (globalThis as { navigator?: { language?: string } }).navigator?.language;
}

function create(host: HTMLElement, auth: RiviumAuth, options: SignInUiOptions, onSignedIn: (r: SignInResult) => void) {
  const strings = uiStrings(options.languageCode ?? browserLanguage());
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  if (options.color && /^#[0-9a-fA-F]{3,8}$/.test(options.color)) host.style.setProperty('--rivium-accent', options.color);
  const root = document.createElement('div');
  root.className = 'rivium';
  root.setAttribute('dir', strings.rtl ? 'rtl' : 'ltr');
  root.setAttribute('lang', strings.lang);
  root.addEventListener('focusin', (e) => {
    const k = (e.target as HTMLElement | null)?.getAttribute?.('data-k');
    if (k) root.setAttribute('data-focus', k);
  });
  const c = new SignInController(auth, options, strings, onSignedIn);
  c.onChange(() => render(c, root));
  return { shadow, style, root, c, strings };
}

/**
 * Puts Rivium's sign-in form inside [target] (any framework, or none). It shows only the methods turned on in the
 * Console and calls `onSignedIn` once a user is signed in.
 *
 * ```ts
 * mountSignIn(document.getElementById('sign-in')!, auth, { onSignedIn: () => location.assign('/home') });
 * ```
 */
export function mountSignIn(
  target: HTMLElement,
  auth: RiviumAuth,
  options: SignInUiOptions & { onSignedIn?: (result: SignInResult) => void } = {},
): MountedSignIn {
  const host = document.createElement('div');
  const { shadow, style, root, c } = create(host, auth, options, (r) => options.onSignedIn?.(r));
  shadow.append(style, root);
  target.append(host);
  void c.load();
  return {
    destroy() {
      c.close();
      host.remove();
    },
  };
}

/**
 * Opens Rivium's sign-in dialog, like FirebaseUI, and answers once the user signed in, or null when they closed it.
 * A dialog on wide screens, the whole screen on phones.
 *
 * ```ts
 * const result = await openSignIn(auth, { appName: 'Tikashop' });
 * if (result) console.log('signed in', result.userId);
 * ```
 */
export function openSignIn(auth: RiviumAuth, options: SignInUiOptions = {}): Promise<SignInResult | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.setAttribute('data-rivium-sign-in', '');
    let settled = false;
    let dialog: HTMLDialogElement;
    const finish = (result: SignInResult | null) => {
      if (settled) return;
      // Not while a sign-in is running: it could land after the dialog answered null.
      if (result === null && c.busy) return;
      settled = true;
      c.close();
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      host.remove();
      resolve(result);
    };
    const { shadow, style, root, c, strings } = create(host, auth, options, (r) => finish(r));
    dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', c.title);
    const inner = document.createElement('div');
    inner.className = 'dialog-inner';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.setAttribute('aria-label', strings.t('close'));
    close.setAttribute('data-k', 'close');
    close.textContent = '✕';
    close.addEventListener('click', () => finish(null));
    inner.append(close, root);
    dialog.append(inner);
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault(); // Esc
      finish(null);
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) finish(null); // the backdrop
    });
    shadow.append(style, dialog);
    document.body.append(host);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    void c.load();
  });
}
