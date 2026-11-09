import type { SignInController } from './controller';

type Attrs = Record<string, string | boolean | undefined>;

/** Builds an element. Text always goes in as text (never as HTML), so nothing from the server or the user can run. */
function h(tag: string, attrs: Attrs = {}, ...children: (Node | string | null | false)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c !== null && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

function header(c: SignInController, title: string, onBack?: () => void): HTMLElement {
  const box = h('div', { class: 'head' });
  if (onBack) {
    const b = h('button', { type: 'button', class: 'back', 'aria-label': c.strings.t('back'), 'data-k': 'back', disabled: c.busy }, c.strings.rtl ? '→' : '←');
    b.addEventListener('click', onBack);
    box.append(b);
  }
  if (c.options.logoUrl) box.append(h('img', { class: 'logo', src: c.options.logoUrl, alt: '' }));
  box.append(h('h2', { class: 'title' }, title));
  return box;
}

function errorBanner(c: SignInController): HTMLElement | null {
  const t = c.errorText;
  return t ? h('div', { class: 'error', role: 'alert', 'data-k': 'error' }, t) : null;
}

function field(c: SignInController, key: string, label: string, value: string, set: (v: string) => void, opts: {
  type?: string; autocomplete?: string; error?: string | null; ltr?: boolean; placeholder?: string; inputmode?: string;
} = {}): HTMLElement {
  const id = `rivium-${key}`;
  const input = h('input', {
    id, name: key, 'data-k': key, type: opts.type ?? 'text', autocomplete: opts.autocomplete, placeholder: opts.placeholder,
    inputmode: opts.inputmode, dir: opts.ltr ? 'ltr' : undefined, disabled: c.busy, 'aria-invalid': opts.error ? 'true' : undefined,
    autocapitalize: 'off', spellcheck: 'false',
  }) as HTMLInputElement;
  input.value = value;
  input.addEventListener('input', () => set(input.value));
  return h('label', { class: 'field', for: id }, h('span', { class: 'label' }, label), input, opts.error ? h('span', { class: 'field-error' }, opts.error) : null);
}

function primary(c: SignInController, key: string, label: string): HTMLElement {
  return h('button', { type: 'submit', class: 'primary', 'data-k': key, disabled: c.busy, 'aria-busy': c.busy ? 'true' : undefined }, c.busy ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : label);
}

function link(c: SignInController, key: string, label: string, onClick: () => void): HTMLElement {
  const b = h('button', { type: 'button', class: 'link', 'data-k': key, disabled: c.busy }, label);
  b.addEventListener('click', onClick);
  return b;
}

function method(c: SignInController, key: string, icon: string, label: string, onClick: () => void): HTMLElement {
  const b = h('button', { type: 'button', class: 'method', 'data-k': key, disabled: c.busy }, h('span', { class: 'icon', 'aria-hidden': 'true' }, icon), label);
  b.addEventListener('click', onClick);
  return b;
}

function form(onSubmit: () => void, ...children: (Node | null | false)[]): HTMLElement {
  const f = h('form', { novalidate: true }, ...children);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    onSubmit();
  });
  return f;
}

function otherMethods(c: SignInController): HTMLElement {
  const t = c.strings.t;
  return h('div', { class: 'methods' },
    c.showGoogle && method(c, 'google', 'G', t('withGoogle'), c.continueWithGoogle),
    c.showApple && method(c, 'apple', '', t('withApple'), c.continueWithApple),
    c.showMagicLink && method(c, 'magic-link', '✉', t('withEmailLink'), () => c.go('magicLink')),
    c.showTelegram && method(c, 'telegram', '➤', t('withTelegram'), () => c.go('telegramPhone')),
    c.showGuest && link(c, 'guest', t('guest'), c.continueAsGuest),
  );
}

function home(c: SignInController): HTMLElement {
  const t = c.strings.t;
  return h('div', {},
    header(c, c.title),
    errorBanner(c),
    c.showPassword && form(c.signIn,
      field(c, 'email', t('email'), c.email, (v) => (c.email = v), { type: 'email', autocomplete: 'email', error: c.emailError, ltr: true }),
      field(c, 'password', t('password'), c.password, (v) => (c.password = v), { type: 'password', autocomplete: 'current-password', error: c.passwordError }),
      h('div', { class: 'end' }, link(c, 'forgot', t('forgot'), () => c.go('forgot'))),
      primary(c, 'sign-in', t('signIn')),
      link(c, 'to-sign-up', t('noAccount'), () => c.go('signUp')),
    ),
    c.showPassword && c.hasOtherMethods && h('div', { class: 'or' }, h('span', {}, t('or'))),
    c.hasOtherMethods && otherMethods(c),
  );
}

function signUp(c: SignInController): HTMLElement {
  const t = c.strings.t;
  return h('div', {},
    header(c, t('signUpTitle'), () => c.back()),
    errorBanner(c),
    form(c.signUp,
      field(c, 'sign-up-email', t('email'), c.email, (v) => (c.email = v), { type: 'email', autocomplete: 'email', error: c.emailError, ltr: true }),
      field(c, 'sign-up-password', t('password'), c.password, (v) => (c.password = v), { type: 'password', autocomplete: 'new-password', error: c.passwordError }),
      primary(c, 'sign-up', t('signUp')),
      link(c, 'to-sign-in', t('haveAccount'), () => c.back()),
    ),
  );
}

function emailOnly(c: SignInController, key: string, title: string, action: string, send: () => void): HTMLElement {
  const t = c.strings.t;
  return h('div', {},
    header(c, title, () => c.back()),
    errorBanner(c),
    form(send,
      field(c, `${key}-email`, t('email'), c.email, (v) => (c.email = v), { type: 'email', autocomplete: 'email', error: c.emailError, ltr: true }),
      primary(c, `${key}-send`, action),
    ),
  );
}

function telegram(c: SignInController): HTMLElement {
  const t = c.strings.t;
  const codeStep = c.view === 'telegramCode';
  const bot = c.safeBotUrl;
  const botName = bot ? `@${new URL(bot).pathname.replace(/^\/+/, '').split('/')[0]}` : '';
  return h('div', {},
    header(c, t('telegramTitle'), () => (codeStep ? c.go('telegramPhone') : c.back())),
    errorBanner(c),
    codeStep
      ? form(c.verifyTelegramCode,
        h('p', {}, t('codeSent')),
        field(c, 'code', t('code'), c.code, (v) => (c.code = v), { autocomplete: 'one-time-code', inputmode: 'numeric', ltr: true }),
        primary(c, 'verify-code', t('verify')),
      )
      : form(c.sendTelegramCode,
        field(c, 'phone', t('phone'), c.phone, (v) => (c.phone = v), { type: 'tel', autocomplete: 'tel', placeholder: t('phoneHint'), ltr: true }),
        bot ? h('p', { 'data-k': 'bot-first' }, t('botFirst').replace('{bot}', botName)) : null,
        bot ? h('p', {}, h('a', { href: bot, target: '_blank', rel: 'noopener noreferrer', dir: 'ltr', 'data-k': 'bot-link' }, bot)) : null,
        primary(c, 'send-code', bot ? t('retry') : t('sendCode')),
      ),
  );
}

function message(c: SignInController): HTMLElement {
  const t = c.strings.t;
  if (c.view === 'unavailable') {
    return h('div', {},
      header(c, c.title),
      h('p', { class: 'center', 'data-k': 'unavailable' }, c.errorText ?? t('noMethods')),
      link(c, 'retry', t('retry'), () => void c.load()),
    );
  }
  const key = c.sent === 'reset' ? 'resetSent' : c.sent === 'magicLink' ? 'linkSent' : 'verifySent';
  const [before, after] = t(key).split('{email}');
  return h('div', {},
    header(c, t('checkEmail')),
    h('p', { class: 'center', 'data-k': 'sent' }, before ?? '', h('bdi', {}, c.email.trim()), after ?? ''),
    link(c, 'back-home', t('back'), () => c.back()),
  );
}

/** Draws the controller's current screen into [root]. */
export function render(c: SignInController, root: HTMLElement): void {
  // The last focused control (kept by mount(): a disabled control loses focus while busy).
  const focused = root.getAttribute('data-focus');
  const previousView = root.getAttribute('data-view');
  const t = c.strings.t;
  const body =
    c.view === 'loading' ? h('div', { class: 'loading', 'aria-busy': 'true' }, h('span', { class: 'spinner big', 'aria-hidden': 'true' }))
      : c.view === 'home' ? home(c)
        : c.view === 'signUp' ? signUp(c)
          : c.view === 'forgot' ? emailOnly(c, 'forgot', t('forgotTitle'), t('sendReset'), c.sendReset)
            : c.view === 'magicLink' ? emailOnly(c, 'magicLink', t('magicTitle'), t('sendLink'), c.sendMagicLink)
              : c.view === 'telegramPhone' || c.view === 'telegramCode' ? telegram(c)
                : message(c);
  root.setAttribute('data-view', c.view);
  root.replaceChildren(body);
  // Keep the keyboard where it was; on a new screen go to its first field.
  const again = focused ? root.querySelector<HTMLElement>(`[data-k="${focused}"]:not([disabled])`) : null;
  if (again && previousView === c.view) again.focus();
  else if (previousView !== c.view) root.querySelector<HTMLElement>('input:not([disabled])')?.focus();
}
