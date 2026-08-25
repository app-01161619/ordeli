import { supabase } from '../supabase-client.js';
import { getSession } from '../auth.js';
import { getMyShop } from '../shop.js';
import { renderOrderForm, onLeave as editorOnLeave } from '../order-editor.js';

let editorActive = false;

/** Called by the router before it renders the next page (see router.js). */
export function onLeave() {
  if (editorActive) editorOnLeave();
  editorActive = false;
}

export async function render(container) {
  editorActive = false;
  container.innerHTML = '<div class="screen"><h1 class="subtitle">Orders</h1><p class="text-secondary">Loading…</p></div>';

  const session = getSession();
  const { shop, role, error: shopError } = await getMyShop(session);

  if (shopError) {
    container.innerHTML = `<div class="screen"><h1 class="subtitle">Orders</h1><p class="error-text">${escapeHtml(shopError)}</p></div>`;
    return;
  }
  if (!shop) {
    container.innerHTML =
      '<div class="screen"><h1 class="subtitle">Orders</h1><p class="empty-state">Finish setting up your shop first.</p></div>';
    return;
  }

  await renderList();

  // Rebuilds `container` from scratch every time, rather than caching a
  // `.screen` element — the editor takes over the same `container` and
  // replaces its content wholesale, so any element reference captured
  // before that would go stale (detached, invisible) the moment we come
  // back here.
  async function renderList(notice) {
    editorActive = false;
    container.innerHTML = '<div class="screen"><h1 class="subtitle">Orders</h1><p class="text-secondary">Loading…</p></div>';

    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('shop_id', shop.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      container.innerHTML = `<div class="screen"><h1 class="subtitle">Orders</h1><p class="error-text">${escapeHtml(error.message)}</p></div>`;
      return;
    }

    const noticeHtml = notice
      ? `<p class="${notice.type === 'error' ? 'error-text' : 'info-text'}">${escapeHtml(notice.message)}</p>`
      : '';

    // Order creation/products are owner-only under RLS ("order creation...
    // are owner tasks") — production members can see this list but not add
    // to it.
    const newOrderButtonHtml =
      role === 'owner'
        ? '<div class="button-row"><button type="button" class="button" data-new-order>+ New order</button></div>'
        : '';

    const rowsHtml =
      !orders || orders.length === 0
        ? '<p class="empty-state">No orders yet. Orders you create will show up here.</p>'
        : orders
            .map(
              (order) => `
              <div class="order-row">
                <p class="text-small-bold">${escapeHtml(order.customer_name)}</p>
                <p class="text-small text-secondary">Production: ${escapeHtml(order.production_status)} · Payment: ${escapeHtml(order.payment_status)}</p>
              </div>
            `
            )
            .join('');

    container.innerHTML = `<div class="screen"><h1 class="subtitle">Orders</h1>${noticeHtml}${newOrderButtonHtml}${rowsHtml}</div>`;

    const newOrderButton = container.querySelector('[data-new-order]');
    if (newOrderButton) {
      newOrderButton.addEventListener('click', () => {
        editorActive = true;
        renderOrderForm(container, {
          shop,
          onCancel: () => renderList(),
          onCreated: ({ partialFailures }) =>
            renderList(
              partialFailures && partialFailures.length > 0
                ? { type: 'error', message: `Order created, but some items couldn't be added: ${partialFailures.join('; ')}` }
                : { type: 'success', message: 'Order created.' }
            ),
        });
      });
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
