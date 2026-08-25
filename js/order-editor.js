// The order-creation flow (#18-20): customer info + a cart of line items,
// each with a product, quantity, unit price, and an optional QR scan
// (#19 validates it against the chosen product and 'available' status).
// Not a routed page — orders.js owns the "orders" tab and mounts this
// directly into its container when the owner taps "+ New order".
//
// order/order_items/products are all owner-only under RLS ("order
// creation... are owner tasks" — see 001_schema.sql) — orders.js is
// responsible for only offering this to role === 'owner' in the first
// place; this module doesn't re-check that itself.
import { supabase } from './supabase-client.js';
import { startQrScanner, cameraErrorMessage, extractToken } from './qr-camera.js';

let scanner = null;
let nextTempId = 1;

/** Called by orders.js's own onLeave (see router.js) while this is mounted. */
export function onLeave() {
  scanner?.stop();
  scanner = null;
}

/**
 * Renders the order-creation flow into `container`, replacing its content.
 * Calls onCancel() if the seller backs out entirely, or
 * onCreated({ partialFailures }) once the order (and at least one item)
 * has been created — partialFailures lists any items that didn't make it
 * in, so the caller can surface that.
 */
export function renderOrderForm(container, { shop, onCancel, onCreated }) {
  onLeave();

  let customerName = '';
  let customerPhone = '';
  let items = [];
  let products = null; // lazy-loaded, then cached for the life of this form

  renderCart();

  // --- shared data ---------------------------------------------------------

  async function ensureProducts() {
    if (products) return products;
    const { data, error } = await supabase
      .from('products')
      .select('id, name, default_unit_price')
      .eq('shop_id', shop.id)
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    products = data ?? [];
    return products;
  }

  function orderTotal() {
    return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  }

  // --- cart view -------------------------------------------------------------

  function renderCart(notice) {
    container.innerHTML = `
      <div class="screen">
        <h1 class="subtitle">New order</h1>

        ${notice ? `<p class="${notice.type === 'error' ? 'error-text' : 'info-text'}">${escapeHtml(notice.message)}</p>` : ''}

        <label for="customer-name">Customer name</label>
        <input id="customer-name" type="text" />

        <label for="customer-phone">Phone (optional)</label>
        <input id="customer-phone" type="text" />

        <div class="stack" style="margin-top: var(--space-5);" data-items></div>

        <div class="button-row">
          <button type="button" class="button button--outline" data-add-item>+ Add item</button>
        </div>

        ${
          items.length > 0
            ? `<p class="text-small-bold" style="margin-top: var(--space-4); text-align: right;">Total: ${formatMoney(orderTotal())}</p>`
            : ''
        }

        <p class="error-text" data-cart-error hidden></p>

        <div class="button-row">
          <button type="button" class="button" data-submit ${items.length === 0 ? 'disabled' : ''}>Create order</button>
          <button type="button" class="button button--outline" data-cancel>Cancel</button>
        </div>
      </div>
    `;

    const screen = container.querySelector('.screen');
    const nameInput = screen.querySelector('#customer-name');
    const phoneInput = screen.querySelector('#customer-phone');
    nameInput.value = customerName;
    phoneInput.value = customerPhone;

    const itemsMount = screen.querySelector('[data-items]');
    itemsMount.innerHTML =
      items.length === 0
        ? '<p class="empty-state">No items yet.</p>'
        : items
            .map(
              (item) => `
              <div class="card cart-item">
                <div>
                  <p class="text-small-bold">${escapeHtml(item.productName)}</p>
                  <p class="text-small text-secondary">${item.quantity} × ${formatMoney(item.unitPrice)} = ${formatMoney(item.quantity * item.unitPrice)}</p>
                  <p class="text-small text-secondary">${item.qrDisplayCode ? `QR: ${escapeHtml(item.qrDisplayCode)}` : 'No QR scanned'}</p>
                </div>
                <button type="button" class="link-button" data-remove="${item.tempId}">Remove</button>
              </div>
            `
            )
            .join('');

    nameInput.addEventListener('input', (e) => {
      customerName = e.target.value;
    });
    phoneInput.addEventListener('input', (e) => {
      customerPhone = e.target.value;
    });
    screen.querySelector('[data-add-item]').addEventListener('click', () => renderItemAdd());
    screen.querySelector('[data-cancel]').addEventListener('click', () => onCancel());
    screen.querySelector('[data-submit]').addEventListener('click', () => submitOrder(screen));

    for (const button of itemsMount.querySelectorAll('[data-remove]')) {
      button.addEventListener('click', () => {
        items = items.filter((i) => i.tempId !== button.dataset.remove);
        renderCart();
      });
    }
  }

  async function submitOrder(cartScreen) {
    const errorEl = cartScreen.querySelector('[data-cart-error]');
    const submitButton = cartScreen.querySelector('[data-submit]');
    errorEl.hidden = true;

    const name = customerName.trim();
    if (!name) {
      errorEl.textContent = 'Enter the customer name.';
      errorEl.hidden = false;
      return;
    }
    if (items.length === 0) {
      errorEl.textContent = 'Add at least one item.';
      errorEl.hidden = false;
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Creating…';

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({ shop_id: shop.id, customer_name: name, customer_phone: customerPhone.trim() || null })
      .select()
      .single();

    if (orderError) {
      errorEl.textContent = orderError.message;
      errorEl.hidden = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Create order';
      return;
    }

    // Items go in one at a time (no cross-table transaction available from
    // the client) — attempt all of them and report failures rather than
    // stopping at the first, since a QR conflict on one item says nothing
    // about the rest.
    const failures = [];
    let succeededCount = 0;

    for (const item of items) {
      const { error: itemError } = await supabase.from('order_items').insert({
        order_id: order.id,
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        qr_code_id: item.qrCodeId,
      });

      if (itemError) {
        failures.push(`${item.productName}: ${itemError.message}`);
      } else {
        succeededCount += 1;
      }
    }

    if (succeededCount === 0) {
      // Nothing made it in — clean up the empty order rather than leaving
      // debris, and let them retry from a clean cart.
      await supabase.from('orders').delete().eq('id', order.id);
      errorEl.textContent = `Couldn't add any items: ${failures.join('; ')}`;
      errorEl.hidden = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Create order';
      return;
    }

    onCreated({ partialFailures: failures });
  }

  // --- add-item view -----------------------------------------------------------

  function renderItemAdd(restore = {}) {
    container.innerHTML = `
      <div class="screen">
        <h1 class="subtitle">Add item</h1>

        <label for="item-product">Product</label>
        <select id="item-product"><option value="">Loading products…</option></select>

        <div data-new-product hidden>
          <label for="new-product-name">New product name</label>
          <input id="new-product-name" type="text" />
          <label for="new-product-price">Starting price</label>
          <input id="new-product-price" type="number" min="0" step="0.01" />
          <p class="error-text" data-new-product-error hidden></p>
          <div class="button-row">
            <button type="button" class="button button--outline" data-create-product>Create product</button>
          </div>
        </div>

        <label for="item-quantity">Quantity</label>
        <input id="item-quantity" type="number" min="1" step="1" />

        <label for="item-price">Unit price</label>
        <input id="item-price" type="number" min="0" step="0.01" />

        <div class="card stack" style="margin-top: var(--space-4);">
          <p class="text-small-bold">QR code (optional)</p>
          <p class="text-small text-secondary" data-qr-status>Not scanned — you can add this without one and assign a QR later.</p>
          <div class="button-row">
            <button type="button" class="button button--outline" data-scan-qr>Scan QR</button>
          </div>
        </div>

        <p class="error-text" data-item-error hidden></p>

        <div class="button-row">
          <button type="button" class="button" data-confirm>Add to order</button>
          <button type="button" class="button button--outline" data-cancel>Cancel</button>
        </div>
      </div>
    `;

    const screen = container.querySelector('.screen');
    const productSelect = screen.querySelector('#item-product');
    const newProductBlock = screen.querySelector('[data-new-product]');
    const quantityInput = screen.querySelector('#item-quantity');
    const priceInput = screen.querySelector('#item-price');
    const qrStatusEl = screen.querySelector('[data-qr-status]');
    const scanQrButton = screen.querySelector('[data-scan-qr]');
    const errorEl = screen.querySelector('[data-item-error]');

    quantityInput.value = restore.quantity ?? 1;
    priceInput.value = restore.unitPrice ?? '';

    let scannedQr = restore.scannedQr ?? null;
    updateQrStatus();

    if (restore.scanRejection) {
      errorEl.textContent = restore.scanRejection;
      errorEl.hidden = false;
    }

    function updateQrStatus() {
      qrStatusEl.textContent = scannedQr
        ? `Scanned: ${scannedQr.displayCode}`
        : 'Not scanned — you can add this without one and assign a QR later.';
      scanQrButton.textContent = scannedQr ? 'Rescan' : 'Scan QR';
    }

    function populateProductSelect(selectedId) {
      productSelect.innerHTML =
        '<option value="">Select a product…</option>' +
        (products ?? []).map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('') +
        '<option value="__new__">+ New product</option>';
      productSelect.value = selectedId ?? '';
      newProductBlock.hidden = productSelect.value !== '__new__';
    }

    ensureProducts()
      .then(() => populateProductSelect(restore.productId))
      .catch((err) => {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
      });

    productSelect.addEventListener('change', () => {
      newProductBlock.hidden = productSelect.value !== '__new__';
      if (productSelect.value && productSelect.value !== '__new__') {
        const selected = products?.find((p) => p.id === productSelect.value);
        if (selected) priceInput.value = selected.default_unit_price;
      }
      // Changing product invalidates whatever was scanned for the old one.
      if (scannedQr) {
        scannedQr = null;
        updateQrStatus();
      }
    });

    screen.querySelector('[data-create-product]').addEventListener('click', async () => {
      const nameInput = screen.querySelector('#new-product-name');
      const startingPriceInput = screen.querySelector('#new-product-price');
      const npErrorEl = screen.querySelector('[data-new-product-error]');
      const createButton = screen.querySelector('[data-create-product]');

      npErrorEl.hidden = true;

      const name = nameInput.value.trim();
      const startingPrice = parseFloat(startingPriceInput.value);

      if (!name) {
        npErrorEl.textContent = 'Enter a product name.';
        npErrorEl.hidden = false;
        return;
      }
      if (!Number.isFinite(startingPrice) || startingPrice < 0) {
        npErrorEl.textContent = 'Enter a valid starting price.';
        npErrorEl.hidden = false;
        return;
      }

      createButton.disabled = true;
      createButton.textContent = 'Creating…';

      const { data: newProduct, error: productError } = await supabase
        .from('products')
        .insert({ shop_id: shop.id, name, default_unit_price: startingPrice })
        .select('id, name, default_unit_price')
        .single();

      if (productError) {
        npErrorEl.textContent = productError.message;
        npErrorEl.hidden = false;
        createButton.disabled = false;
        createButton.textContent = 'Create product';
        return;
      }

      products = [...(products ?? []), newProduct];
      populateProductSelect(newProduct.id);
      priceInput.value = newProduct.default_unit_price;
    });

    scanQrButton.addEventListener('click', () => {
      const productId = productSelect.value;
      if (!productId || productId === '__new__') {
        errorEl.textContent = 'Pick (or create) a product first.';
        errorEl.hidden = false;
        return;
      }
      errorEl.hidden = true;
      renderQrScan(productId, {
        productId,
        quantity: quantityInput.value,
        unitPrice: priceInput.value,
        scannedQr,
      });
    });

    screen.querySelector('[data-cancel]').addEventListener('click', () => renderCart());

    screen.querySelector('[data-confirm]').addEventListener('click', () => {
      errorEl.hidden = true;

      const productId = productSelect.value;
      const quantity = parseInt(quantityInput.value, 10);
      const unitPrice = parseFloat(priceInput.value);

      if (!productId || productId === '__new__') {
        errorEl.textContent = 'Pick (or create) a product.';
        errorEl.hidden = false;
        return;
      }
      if (!Number.isInteger(quantity) || quantity < 1) {
        errorEl.textContent = 'Enter a quantity of at least 1.';
        errorEl.hidden = false;
        return;
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        errorEl.textContent = 'Enter a valid unit price.';
        errorEl.hidden = false;
        return;
      }

      const productName = products?.find((p) => p.id === productId)?.name ?? 'Product';

      items = [
        ...items,
        {
          tempId: `item-${nextTempId++}`,
          productId,
          productName,
          quantity,
          unitPrice,
          qrCodeId: scannedQr?.id ?? null,
          qrDisplayCode: scannedQr?.displayCode ?? null,
        },
      ];

      renderCart();
    });
  }

  // --- QR scan (per item) sub-view --------------------------------------------

  async function renderQrScan(productId, restore) {
    scanner?.stop();
    scanner = null;

    const productName = products?.find((p) => p.id === productId)?.name ?? 'this product';

    container.innerHTML = `
      <div class="screen">
        <h1 class="subtitle">Scan QR</h1>
        <div class="scan-viewport">
          <video autoplay playsinline muted></video>
          <div class="scan-frame"></div>
        </div>
        <p class="scan-hint text-secondary">Scan the ${escapeHtml(productName)} QR for this item.</p>
        <div class="button-row">
          <button type="button" class="button button--outline" data-cancel-scan>Cancel</button>
        </div>
      </div>
    `;

    const screen = container.querySelector('.screen');
    screen.querySelector('[data-cancel-scan]').addEventListener('click', () => {
      scanner?.stop();
      scanner = null;
      renderItemAdd(restore);
    });

    try {
      scanner = await startQrScanner(screen.querySelector('video'), async (text) => {
        scanner = null;
        const result = await validateQrForProduct(text, productId);
        renderItemAdd(
          result.ok
            ? { ...restore, scannedQr: { id: result.qrId, displayCode: result.displayCode } }
            : { ...restore, scanRejection: result.message }
        );
      });
    } catch (err) {
      renderItemAdd({ ...restore, scanRejection: cameraErrorMessage(err) });
    }
  }

  // Rule #19: accept only if the code exists for this shop, matches the
  // product being added, and is currently available.
  async function validateQrForProduct(scannedText, productId) {
    const token = extractToken(scannedText);

    const { data: qrRow, error } = await supabase
      .from('qr_codes')
      .select('id, status, display_code, product_id')
      .eq('shop_id', shop.id)
      .eq('code_token', token)
      .maybeSingle();

    if (error) return { ok: false, message: error.message };
    if (!qrRow) return { ok: false, message: "That code isn't recognized for this shop." };

    if (qrRow.product_id !== productId) {
      const wrongProduct = (products ?? []).find((p) => p.id === qrRow.product_id);
      return { ok: false, message: `That's a ${wrongProduct?.name ?? 'different product\u2019s'} QR, not this one.` };
    }
    if (qrRow.status !== 'available') {
      const statusLabel = qrRow.status === 'assigned' ? 'already assigned to another order' : qrRow.status;
      return { ok: false, message: `That QR is ${statusLabel}.` };
    }

    return { ok: true, qrId: qrRow.id, displayCode: qrRow.display_code };
  }
}

// --- small helpers -----------------------------------------------------------

function formatMoney(amount) {
  return `₱${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
