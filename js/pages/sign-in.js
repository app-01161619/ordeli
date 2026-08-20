import { renderConnectionStatus } from '../connection-status.js';
import { signInWithPassword } from '../auth.js';

export async function render(container) {
  container.innerHTML = '';

  const screen = document.createElement('div');
  screen.className = 'screen screen--centered';
  container.appendChild(screen);

  const connectionMount = document.createElement('div');
  screen.appendChild(connectionMount);
  renderConnectionStatus(connectionMount);

  const rest = document.createElement('div');
  rest.innerHTML = `
    <h1 class="title">Ordeli</h1>
    <p class="text-secondary" style="margin: 0 0 8px 0;">Sign in to manage your shop</p>

    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="email" />

    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password" />

    <p class="error-text" data-error hidden></p>

    <div class="button-row">
      <button type="button" class="button" data-sign-in>Sign in</button>
    </div>

    <p style="text-align: center; margin-top: 24px;">
      <a href="#/sign-up">New seller? Create an account</a>
    </p>
  `;
  screen.appendChild(rest);

  const emailInput = rest.querySelector('#email');
  const passwordInput = rest.querySelector('#password');
  const errorEl = rest.querySelector('[data-error]');
  const submitButton = rest.querySelector('[data-sign-in]');

  async function handleSubmit() {
    errorEl.hidden = true;

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      errorEl.textContent = 'Enter your email and password.';
      errorEl.hidden = false;
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Signing in…';

    const { error } = await signInWithPassword(email, password);

    submitButton.disabled = false;
    submitButton.textContent = 'Sign in';

    if (error) {
      errorEl.textContent = error;
      errorEl.hidden = false;
      return;
    }

    // On success, auth.js's onAuthStateChange listener fires and app.js
    // re-runs the router automatically — nothing else to do here.
  }

  submitButton.addEventListener('click', handleSubmit);
  passwordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleSubmit();
  });
}
