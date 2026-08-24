import { supabase } from '../supabase-client.js';
import { getSession } from '../auth.js';
import { getMyShop } from '../shop.js';

export async function render(container) {
  container.innerHTML = '';

  const screen = document.createElement('div');
  screen.className = 'screen';
  screen.innerHTML = '<h1 class="subtitle">Orders</h1><p class="text-secondary">Loading…</p>';
  container.appendChild(screen);

  const session = getSession();
  const { shop, error: shopError } = await getMyShop(session);

  if (shopError) {
    screen.innerHTML = `<h1 class="subtitle">Orders</h1><p class="error-text">${escapeHtml(shopError)}</p>`;
    return;
  }

  if (!shop) {
    screen.innerHTML = '<h1 class="subtitle">Orders</h1><p class="empty-state">Finish setting up your shop first.</p>';
    return;
  }

  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .eq('shop_id', shop.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    screen.innerHTML = `<h1 class="subtitle">Orders</h1><p class="error-text">${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!orders || orders.length === 0) {
    screen.innerHTML = `
      <h1 class="subtitle">Orders</h1>
      <p class="empty-state">No orders yet. Orders you create will show up here.</p>
    `;
    return;
  }

  const rows = orders
    .map(
      (order) => `
      <div class="order-row">
        <p class="text-small-bold">${escapeHtml(order.customer_name)}</p>
        <p class="text-small text-secondary">Production: ${escapeHtml(order.production_status)} · Payment: ${escapeHtml(order.payment_status)}</p>
      </div>
    `
    )
    .join('');

  screen.innerHTML = `<h1 class="subtitle">Orders</h1>${rows}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
