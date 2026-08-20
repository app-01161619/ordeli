import { supabase } from '../supabase-client.js';
import { signUpWithPassword } from '../auth.js';
import { invalidateShopCache } from '../shop.js';

export async function render(container) {
  container.innerHTML = '';

  const screen = document.createElement('div');
  screen.className = 'screen screen--centered';
  container.appendChild(screen);
  renderForm(screen);
}

function renderForm(screen) {
  screen.innerHTML = `
    <h1 class="title">Create your shop</h1>
    <p class="text-secondary" style="margin: 0 0 8px 0;">
      One account, one shop. You can add production team members later.
    </p>

    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="email" />

    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="new-password" />

    <label for="shop-name">Shop name</label>
    <input id="shop-name" type="text" autocomplete="organization" />

    <label for="shop-address">Shop address</label>
    <input id="shop-address" type="text" autocomplete="street-address" />

    <p class="error-text" data-error hidden></p>

    <div class="button-row">
      <button type="button" class="button" data-submit>Create account</button>
    </div>

    <p style="text-align: center; margin-top: 24px;">
      <a href="#/sign-in">Already have an account? Sign in</a>
    </p>
  `;

  const emailInput = screen.querySelector('#email');
  const passwordInput = screen.querySelector('#password');
  const shopNameInput = screen.querySelector('#shop-name');
  const shopAddressInput = screen.querySelector('#shop-address');
  const errorEl = screen.querySelector('[data-error]');
  const submitButton = screen.querySelector('[data-submit]');

  submitButton.addEventListener('click', async () => {
    errorEl.hidden = true;

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const shopName = shopNameInput.value.trim();
    const shopAddress = shopAddressInput.value.trim();

    if (!email || !password || !shopName || !shopAddress) {
      errorEl.textContent = 'Fill in every field.';
      errorEl.hidden = false;
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Creating…';

    const { session, error, userId } = await signUpWithPassword(email, password);

    if (error) {
      submitButton.disabled = false;
      submitButton.textContent = 'Create account';
      errorEl.textContent = error;
      errorEl.hidden = false;
      return;
    }

    // If your Supabase project has "Confirm email" turned on, there's no
    // session yet — the shops row can't be inserted until the owner is
    // actually authenticated (RLS requires owner_id = auth.uid()).
    if (!session) {
      renderCheckEmail(screen, email);
      return;
    }

    const { error: shopError } = await supabase.from('shops').insert({
      owner_id: userId,
      name: shopName,
      address: shopAddress,
    });

    submitButton.disabled = false;
    submitButton.textContent = 'Create account';

    if (shopError) {
      errorEl.textContent = `Account created, but saving your shop failed: ${shopError.message}`;
      errorEl.hidden = false;
      return;
    }

    invalidateShopCache();
    // auth.js's onAuthStateChange listener already fired when signUp
    // established a session — app.js's router will pick this up and route
    // to Home on its own.
  });
}

function renderCheckEmail(screen, email) {
  screen.innerHTML = `
    <h1 class="title">Check your email</h1>
    <p class="text-secondary">
      We sent a confirmation link to ${escapeHtml(email)}. Confirm it, then come back and sign in —
      you can finish setting up your shop from there.
    </p>
    <p style="text-align: center; margin-top: 24px;">
      <a href="#/sign-in">Back to sign in</a>
    </p>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
