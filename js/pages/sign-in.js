import { renderConnectionStatus } from '../connection-status.js';
import { signInWithPassword, signUpWithPassword } from '../auth.js';

export async function render(container) {
  container.innerHTML = '';

  const screen = document.createElement('div');
  screen.className = 'screen screen--centered';
  container.appendChild(screen);

  const connectionMount = document.createElement('div');
  screen.appendChild(connectionMount);
  renderConnectionStatus(connectionMount);

  const formMount = document.createElement('div');
  screen.appendChild(formMount);

  let mode = 'sign-in'; // 'sign-in' | 'sign-up'
  renderForm();

  function renderForm() {
    const isSignUp = mode === 'sign-up';

    formMount.innerHTML = `
      <h1 class="title">Ordeli</h1>
      <p class="text-secondary" style="margin: 0 0 32px 0;">
        ${isSignUp ? 'Create an account to manage your shop' : 'Sign in to manage your shop'}
      </p>

      <label for="auth-email">Email</label>
      <input id="auth-email" type="email" autocomplete="email" />

      <label for="auth-password">Password</label>
      <input
        id="auth-password"
        type="password"
        autocomplete="${isSignUp ? 'new-password' : 'current-password'}"
      />

      <p class="info-text" data-info hidden></p>
      <p class="error-text" data-error hidden></p>

      <div class="button-row">
        <button type="button" class="button" data-submit>
          ${isSignUp ? 'Create account' : 'Sign in'}
        </button>
      </div>

      <p class="text-small" style="text-align: center; margin-top: var(--space-3);">
        ${isSignUp ? 'Already have an account?' : "Don't have an account?"}
        <button type="button" class="link-button" data-toggle-mode>
          ${isSignUp ? 'Sign in' : 'Sign up'}
        </button>
      </p>
    `;

    const emailInput = formMount.querySelector('#auth-email');
    const passwordInput = formMount.querySelector('#auth-password');
    const infoEl = formMount.querySelector('[data-info]');
    const errorEl = formMount.querySelector('[data-error]');
    const submitButton = formMount.querySelector('[data-submit]');

    formMount.querySelector('[data-toggle-mode]').addEventListener('click', () => {
      mode = isSignUp ? 'sign-in' : 'sign-up';
      renderForm();
    });

    submitButton.addEventListener('click', () => handleSubmit(isSignUp));

    // Enter in either field submits, since these inputs aren't wrapped in a
    // <form> (nothing here should trigger a full-page navigation/reload).
    for (const input of [emailInput, passwordInput]) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') handleSubmit(isSignUp);
      });
    }

    async function handleSubmit(isSignUp) {
      infoEl.hidden = true;
      errorEl.hidden = true;

      const email = emailInput.value.trim();
      const password = passwordInput.value;

      if (!email || !password) {
        errorEl.textContent = 'Fill in both fields.';
        errorEl.hidden = false;
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = isSignUp ? 'Creating account…' : 'Signing in…';

      const { data, error } = isSignUp
        ? await signUpWithPassword(email, password)
        : await signInWithPassword(email, password);

      if (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
        submitButton.disabled = false;
        submitButton.textContent = isSignUp ? 'Create account' : 'Sign in';
        return;
      }

      // A session means auth.js's onAuthStateChange listener (see app.js)
      // fires next and the router takes it from here — leave the button in
      // its loading state rather than re-enabling it right before the
      // re-render swaps this screen out.
      if (data.session) return;

      // No session back from sign-up: the Supabase project has "Confirm
      // email" turned on, so there's a user row but nothing to sign in to
      // yet. Send them to sign-in with a clear next step instead of leaving
      // them stuck on a form that looks like it did nothing.
      mode = 'sign-in';
      renderForm();
      const info = formMount.querySelector('[data-info]');
      info.textContent = 'Check your email to confirm your account, then sign in.';
      info.hidden = false;
    }
  }
}
