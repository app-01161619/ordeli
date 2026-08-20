import { supabase } from '../supabase-client.js';
import { getSession } from '../auth.js';
import { invalidateShopCache } from '../shop.js';

export async function render(container) {
  container.innerHTML = '';

  const screen = document.createElement('div');
  screen.className = 'screen screen--centered';
  screen.innerHTML = `
    <h1 class="title">Set up your shop</h1>
    <p class="text-secondary" style="margin: 0 0 24px 0;">
      One account, one shop. You can add production team members later.
    </p>

    <label for="shop-name">Shop name</label>
    <input id="shop-name" type="text" autocomplete="organization" />

    <label for="shop-address">Shop address</label>
    <input id="shop-address" type="text" autocomplete="street-address" />

    <p class="error-text" data-error hidden></p>

    <div class="button-row">
      <button type="button" class="button" data-submit>Create shop</button>
    </div>
  `;
  container.appendChild(screen);

  const nameInput = screen.querySelector('#shop-name');
  const addressInput = screen.querySelector('#shop-address');
  const errorEl = screen.querySelector('[data-error]');
  const submitButton = screen.querySelector('[data-submit]');

  submitButton.addEventListener('click', async () => {
    errorEl.hidden = true;

    const name = nameInput.value.trim();
    const address = addressInput.value.trim();

    if (!name || !address) {
      errorEl.textContent = 'Fill in both fields.';
      errorEl.hidden = false;
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Creating…';

    const session = getSession();
    const { error } = await supabase.from('shops').insert({
      owner_id: session.user.id,
      name,
      address,
    });

    if (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Create shop';
      return;
    }

    // The router re-resolves the shop on every navigation, so just clear
    // the cache and send the user to Home now that the row exists.
    invalidateShopCache();
    window.location.hash = '#/home';
  });
}
