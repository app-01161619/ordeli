import { renderConnectionStatus } from '../connection-status.js';
import { signInWithApple, signInWithGoogle } from '../auth.js';

const GOOGLE_ICON = `
<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
  <path fill="#4285F4" d="M19.6 10.23c0-.68-.06-1.36-.18-2H10v3.79h5.4a4.62 4.62 0 0 1-2 3.03v2.5h3.23c1.9-1.75 2.97-4.32 2.97-7.32z"/>
  <path fill="#34A853" d="M10 20c2.7 0 4.96-.89 6.62-2.42l-3.23-2.5c-.9.6-2.05.96-3.39.96-2.6 0-4.8-1.76-5.59-4.12H1.06v2.59A10 10 0 0 0 10 20z"/>
  <path fill="#FBBC05" d="M4.41 11.92A5.99 5.99 0 0 1 4.09 10c0-.67.11-1.32.32-1.92V5.49H1.06A10 10 0 0 0 0 10c0 1.61.39 3.14 1.06 4.51l3.35-2.59z"/>
  <path fill="#EA4335" d="M10 3.96c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.96 9.96 0 0 0 10 0 10 10 0 0 0 1.06 5.49l3.35 2.59C5.2 5.72 7.4 3.96 10 3.96z"/>
</svg>`;

const APPLE_ICON = `
<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
  <path d="M13.8 3.6c.7-.85 1.18-2.02 1.05-3.2-1.02.04-2.26.68-3 1.53-.65.75-1.22 1.96-1.07 3.1 1.13.09 2.3-.57 3.02-1.43zM17.3 14.02c-.03-2.02 1.65-2.99 1.72-3.04-.94-1.37-2.4-1.56-2.92-1.58-1.24-.13-2.43.73-3.06.73-.63 0-1.6-.71-2.64-.69-1.36.02-2.62.79-3.32 2.01-1.42 2.46-.36 6.1 1.02 8.1.67.98 1.47 2.08 2.52 2.04 1.01-.04 1.4-.65 2.62-.65 1.22 0 1.57.65 2.64.63 1.09-.02 1.78-.99 2.44-1.98.77-1.14 1.09-2.24 1.11-2.3-.02-.01-2.13-.82-2.13-3.27z"/>
</svg>`;

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
    <p class="text-secondary" style="margin: 0 0 32px 0;">Sign in to manage your shop</p>

    <div class="button-row">
      <button type="button" class="oauth-button" data-provider="google">
        ${GOOGLE_ICON}
        <span>Continue with Google</span>
      </button>
      <button type="button" class="oauth-button" data-provider="apple">
        ${APPLE_ICON}
        <span>Continue with Apple</span>
      </button>
    </div>

    <p class="error-text" data-error hidden></p>
  `;
  screen.appendChild(rest);

  const errorEl = rest.querySelector('[data-error]');

  rest.querySelector('[data-provider="google"]').addEventListener('click', async (event) => {
    await handleOAuthClick(event.currentTarget, signInWithGoogle, errorEl);
  });

  rest.querySelector('[data-provider="apple"]').addEventListener('click', async (event) => {
    await handleOAuthClick(event.currentTarget, signInWithApple, errorEl);
  });
}

async function handleOAuthClick(button, signInFn, errorEl) {
  errorEl.hidden = true;
  button.disabled = true;

  const { error } = await signInFn();

  // On success, signInWithOAuth navigates the browser away to the
  // provider's login page — this code won't even run. We only get here on
  // failure (e.g. the provider isn't enabled in Supabase yet).
  if (error) {
    errorEl.textContent = error.message;
    errorEl.hidden = false;
    button.disabled = false;
  }
}
