import { getSession, signOut } from '../auth.js';
import { getMyShop } from '../shop.js';
import { renderProductManager } from '../product-editor.js';

export async function render(container) {
  const session = getSession();
  const { shop, role } = await getMyShop(session);

  renderMore();

  function renderMore() {
    container.innerHTML = `
      <div class="screen">
        <h1 class="subtitle">More</h1>

        <div class="stack" style="margin-bottom: 32px;">
          <p class="text-small text-secondary" style="margin-bottom: 4px;">Signed in as</p>
          <p>${escapeHtml(session?.user.email ?? session?.user.id ?? '')}</p>
        </div>

        ${
          role === 'owner'
            ? '<div class="button-row"><button type="button" class="button button--outline" data-manage-products>Manage products</button></div>'
            : ''
        }

        <button type="button" class="button button--danger" data-sign-out>Sign out</button>
      </div>
    `;

    const manageProductsButton = container.querySelector('[data-manage-products]');
    if (manageProductsButton) {
      manageProductsButton.addEventListener('click', () => {
        renderProductManager(container, { shop, onDone: () => renderMore() });
      });
    }

    container.querySelector('[data-sign-out]').addEventListener('click', async () => {
      await signOut();
    });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
