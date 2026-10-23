/**
 * Rivium Auth Web SDK example.
 *
 * Uses the public API key only. Put yours in `.env` (see `.env.example`); the placeholder below is not a real key.
 */
import { createRiviumAuth, isRiviumAuthError } from '@rivium/auth-web';

const API_KEY: string = import.meta.env.VITE_RIVIUM_API_KEY || 'rv_live_YOUR_PUBLIC_KEY';

// Memory storage (the default): the user signs in again after a reload.
// To keep the session, pass `storage: localStorageStorage()` (read the README's warning first).
const auth = createRiviumAuth({ apiKey: API_KEY });

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const statusEl = $('status');
const userIdEl = $('user-id');
const methodsEl = $('methods');
const logEl = $<HTMLOListElement>('log');
const emailEl = $<HTMLInputElement>('email');
const passwordEl = $<HTMLInputElement>('password');

function log(message: string, kind: 'info' | 'error' = 'info'): void {
  const li = document.createElement('li');
  li.className = kind;
  li.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  logEl.prepend(li);
}

function describe(error: unknown): string {
  if (isRiviumAuthError(error)) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/** Runs an SDK call, disables the buttons while it runs and logs the outcome. */
async function run(label: string, action: () => Promise<string | void>): Promise<void> {
  const buttons = document.querySelectorAll<HTMLButtonElement>('button');
  buttons.forEach((b) => (b.disabled = true));
  try {
    const result = await action();
    log(result ? `${label}: ${result}` : label);
  } catch (error) {
    log(`${label} failed - ${describe(error)}`, 'error');
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

function credentials(): { email: string; password: string } | null {
  const email = emailEl.value.trim();
  const password = passwordEl.value;
  if (!email || !password) {
    log('Enter an e-mail and a password first', 'error');
    return null;
  }
  return { email, password };
}

// ── Auth state ───────────────────────────────────────────────────────────────────────────────────

auth.onAuthStateChanged((userId) => {
  statusEl.textContent = userId ? 'Signed in' : 'Signed out';
  userIdEl.textContent = userId ?? '-';
});

if (API_KEY.includes('YOUR_PUBLIC_KEY')) {
  $('key-warning').hidden = false;
  methodsEl.textContent = 'Set your API key to load them';
} else {
  auth
    .getMethods()
    .then(({ methods }) => (methodsEl.textContent = methods.length ? methods.join(', ') : 'none'))
    .catch((error) => {
      methodsEl.textContent = 'Could not load';
      log(`getMethods failed - ${describe(error)}`, 'error');
    });
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────────────

$('anon-btn').addEventListener('click', () =>
  run('Signed in anonymously', async () => (await auth.signInAnonymously()).userId),
);

$('email-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = credentials();
  if (input) void run('Signed in with e-mail', async () => (await auth.signInWithEmail(input)).userId);
});

$('signup-btn').addEventListener('click', () => {
  const input = credentials();
  if (!input) return;
  void run('Signed up', async () => {
    const result = await auth.signUpWithEmail(input);
    if (!result.signedIn) return 'check your inbox and verify your e-mail, then sign in';
    return result.verificationSent ? `${result.userId} (verification e-mail sent)` : result.userId;
  });
});

$('link-btn').addEventListener('click', () => {
  const input = credentials();
  if (!input) return;
  void run('Linked e-mail to the current user', async () => (await auth.linkPassword(input)).userId);
});

// ── Magic link ───────────────────────────────────────────────────────────────────────────────────

/** The token from a pasted link (…?token=…) or a bare token. */
function magicToken(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    return new URL(v).searchParams.get('token');
  } catch {
    return v;
  }
}

$('magic-send-btn').addEventListener('click', () => {
  const email = emailEl.value.trim();
  if (!email) {
    log('Enter an e-mail first', 'error');
    return;
  }
  const redirectUrl = $<HTMLInputElement>('magic-redirect').value.trim();
  void run('Magic link sent', async () => {
    await auth.sendMagicLink({ email, redirectUrl });
    return `check ${email} (the answer is the same whether or not the address has an account)`;
  });
});

const signInWithLink = (token: string) =>
  run('Signed in with the magic link', async () => (await auth.signInWithMagicLink({ token })).userId);

$('magic-signin-btn').addEventListener('click', () => {
  const token = magicToken($<HTMLInputElement>('magic-link').value);
  if (token) void signInWithLink(token);
  else log('Paste the link from the e-mail first', 'error');
});

// Opened from the e-mail link itself (a page served at an allowed https address): sign in at once.
const opened = new URLSearchParams(window.location.search).get('token');
if (opened && !API_KEY.includes('YOUR_PUBLIC_KEY')) {
  history.replaceState(null, '', window.location.pathname);
  void signInWithLink(opened);
}

$('me-btn').addEventListener('click', () =>
  run('Profile', async () => JSON.stringify(await auth.getMe())),
);

$('token-btn').addEventListener('click', () =>
  run('Token', async () => {
    // getToken() resolves to null while signed out; this is what you pass to Sync, Push and A/B Testing.
    const token = await auth.getToken();
    return token ? `${token.slice(0, 16)}… (${token.length} chars)` : 'null (signed out)';
  }),
);

$('signout-btn').addEventListener('click', () => run('Signed out', () => auth.signOut()));

$('delete-btn').addEventListener('click', () => {
  if (!auth.isSignedIn) {
    log('Sign in first', 'error');
    return;
  }
  if (!window.confirm('Delete this account? This cannot be undone.')) return;
  void run('Account deleted', () => auth.deleteAccount());
});
