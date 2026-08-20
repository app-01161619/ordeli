import { renderConnectionStatus } from '../connection-status.js';
import { getSession } from '../auth.js';
import { getMyShop } from '../shop.js';

export async function render(container) {
  container.innerHTML = '';

  const screen = document.createElement('div');
  screen.className = 'screen';
  container.appendChild(screen);

  const connectionMount = document.createElement('div');
  screen.appendChild(connectionMount);
  renderConnectionStatus(connectionMount);

  const body = document.createElement('div');
  body.innerHTML = '<p class="text-secondary">Loading your shop…</p>';
  screen.appendChild(body);

  const session = getSession();
  const { shop, role, error } = await getMyShop(session);

  if (error) {
    body.innerHTML = `<p class="error-text">${escapeHtml(error)}</p>`;
    return;
  }

  body.innerHTML = `
    <h1 class="title">${shop ? escapeHtml(shop.name) : 'Welcome'}</h1>
    <p class="text-secondary" style="margin: 0 0 16px 0;">Signed in as ${escapeHtml(session.user.email ?? session.user.id)}</p>
    ${
      shop
        ? `<div class="card stack">
             <p class="text-small-bold">${role === 'owner' ? 'Shop owner name' : 'Production team member'}</p>
             <p class="text-small text-secondary">${escapeHtml(shop.address)}</p>
           </div>`
        : ''
    }
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
