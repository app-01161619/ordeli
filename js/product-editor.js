// Product catalog management (#4, #8): create/edit products and each
// product's workflow-stage template. Not a routed page — more.js mounts
// this directly when the owner taps "Manage products" (no camera or other
// live resource involved, so unlike order-editor.js there's no onLeave to
// export here).
//
// products & product_workflow_stages are both owner-managed under RLS —
// more.js is responsible for only offering the entry point to
// role === 'owner' in the first place; this module doesn't re-check that.
import { supabase } from './supabase-client.js';

/**
 * Renders the product-management flow into `container`, replacing its
 * content. Calls onDone() when the seller backs out to More.
 */
export function renderProductManager(container, { shop, onDone }) {
  renderList();

  // --- product list ----------------------------------------------------------

  async function renderList(notice) {
    container.innerHTML = '<div class="screen"><h1 class="subtitle">Products</h1><p class="text-secondary">Loading…</p></div>';

    const { data: products, error } = await supabase
      .from('products')
      .select('id, name, default_unit_price, is_active')
      .eq('shop_id', shop.id)
      .order('name');

    if (error) {
      container.innerHTML = `<div class="screen"><h1 class="subtitle">Products</h1><p class="error-text">${escapeHtml(error.message)}</p></div>`;
      return;
    }

    const noticeHtml = notice
      ? `<p class="${notice.type === 'error' ? 'error-text' : 'info-text'}">${escapeHtml(notice.message)}</p>`
      : '';

    const rowsHtml =
      !products || products.length === 0
        ? '<p class="empty-state">No products yet.</p>'
        : products
            .map(
              (p) => `
              <div class="card cart-item" data-product-row="${p.id}" style="margin-bottom: var(--space-3);">
                <div>
                  <p class="text-small-bold">${escapeHtml(p.name)}${p.is_active ? '' : ' (inactive)'}</p>
                  <p class="text-small text-secondary">${formatMoney(p.default_unit_price)}</p>
                </div>
                <button type="button" class="link-button" data-edit="${p.id}">Edit</button>
              </div>
            `
            )
            .join('');

    container.innerHTML = `
      <div class="screen">
        <h1 class="subtitle">Products</h1>
        ${noticeHtml}
        <div class="button-row">
          <button type="button" class="button button--outline" data-add>+ Add product</button>
        </div>
        ${rowsHtml}
        <div class="button-row" style="margin-top: var(--space-5);">
          <button type="button" class="button button--outline" data-back>Back</button>
        </div>
      </div>
    `;

    container.querySelector('[data-add]').addEventListener('click', () => renderForm(null));
    container.querySelector('[data-back]').addEventListener('click', () => onDone());

    for (const button of container.querySelectorAll('[data-edit]')) {
      button.addEventListener('click', () => {
        const product = products.find((p) => p.id === button.dataset.edit);
        renderForm(product);
      });
    }
  }

  // --- add / edit product form ------------------------------------------------

  function renderForm(product) {
    const isNew = !product;
    let stages = []; // loaded async below, only relevant once !isNew

    container.innerHTML = `
      <div class="screen">
        <h1 class="subtitle">${isNew ? 'New product' : 'Edit product'}</h1>

        <label for="product-name">Name</label>
        <input id="product-name" type="text" />

        <label for="product-price">Default price</label>
        <input id="product-price" type="number" min="0" step="0.01" />

        ${
          isNew
            ? ''
            : `<label style="display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-4);">
                 <input id="product-active" type="checkbox" />
                 <span>Active (shows up when creating orders)</span>
               </label>`
        }

        <p class="error-text" data-form-error hidden></p>

        <div class="button-row">
          <button type="button" class="button" data-save>${isNew ? 'Create product' : 'Save changes'}</button>
          <button type="button" class="button button--outline" data-cancel>${isNew ? 'Cancel' : 'Back to products'}</button>
        </div>

        ${isNew ? '' : '<div data-stages-section></div>'}
      </div>
    `;

    const screen = container.querySelector('.screen');
    const nameInput = screen.querySelector('#product-name');
    const priceInput = screen.querySelector('#product-price');
    const errorEl = screen.querySelector('[data-form-error]');
    const saveButton = screen.querySelector('[data-save]');

    nameInput.value = product?.name ?? '';
    priceInput.value = product?.default_unit_price ?? '';

    if (!isNew) {
      screen.querySelector('#product-active').checked = product.is_active;
      loadStages(product.id);
    }

    screen.querySelector('[data-cancel]').addEventListener('click', () => renderList());

    saveButton.addEventListener('click', async () => {
      errorEl.hidden = true;

      const name = nameInput.value.trim();
      const price = parseFloat(priceInput.value);

      if (!name) {
        errorEl.textContent = 'Enter a product name.';
        errorEl.hidden = false;
        return;
      }
      if (!Number.isFinite(price) || price < 0) {
        errorEl.textContent = 'Enter a valid price.';
        errorEl.hidden = false;
        return;
      }

      saveButton.disabled = true;
      saveButton.textContent = isNew ? 'Creating…' : 'Saving…';

      if (isNew) {
        const { data: newProduct, error } = await supabase
          .from('products')
          .insert({ shop_id: shop.id, name, default_unit_price: price })
          .select()
          .single();

        if (error) {
          errorEl.textContent = error.message;
          errorEl.hidden = false;
          saveButton.disabled = false;
          saveButton.textContent = 'Create product';
          return;
        }
        // Straight into edit mode for the product we just created, so
        // stages can be added right away without a separate step.
        renderForm(newProduct);
        return;
      }

      const isActive = screen.querySelector('#product-active').checked;
      const { error } = await supabase
        .from('products')
        .update({ name, default_unit_price: price, is_active: isActive })
        .eq('id', product.id);

      if (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
        saveButton.disabled = false;
        saveButton.textContent = 'Save changes';
        return;
      }
      renderList({ type: 'success', message: 'Product saved.' });
    });

    // --- workflow stages for this product (#4, #8) ---------------------------

    async function loadStages(productId) {
      const mount = screen.querySelector('[data-stages-section]');
      mount.innerHTML = '<p class="text-secondary" style="margin-top: var(--space-5);">Loading stages…</p>';

      const { data, error } = await supabase
        .from('product_workflow_stages')
        .select('id, stage_order, stage_name')
        .eq('product_id', productId)
        .order('stage_order');

      if (error) {
        mount.innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
        return;
      }

      stages = data ?? [];
      drawStages(mount, productId);
    }

    function drawStages(mount, productId) {
      const rowsHtml =
        stages.length === 0
          ? '<p class="empty-state">No stages yet — this product completes production instantly (#7).</p>'
          : stages
              .map(
                (s, i) => `
                <div class="card cart-item" style="margin-bottom: var(--space-2); align-items: center;">
                  <input type="text" data-stage-input="${s.id}" style="flex: 1; margin-right: var(--space-2);" />
                  <div style="display: flex; gap: var(--space-2); flex-shrink: 0;">
                    <button type="button" class="link-button" data-move-up="${s.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" class="link-button" data-move-down="${s.id}" ${i === stages.length - 1 ? 'disabled' : ''}>↓</button>
                    <button type="button" class="link-button" data-remove-stage="${s.id}">Remove</button>
                  </div>
                </div>
              `
              )
              .join('');

      mount.innerHTML = `
        <p class="text-small-bold" style="margin-top: var(--space-5);">Production stages</p>
        <p class="text-small text-secondary">Finished in this order (#5) — editing only affects new orders; existing orders keep their own copy (#8).</p>
        <div class="stack" style="margin-top: var(--space-3);">${rowsHtml}</div>
        <label for="new-stage-name" style="margin-top: var(--space-4);">Add a stage</label>
        <div style="display: flex; gap: var(--space-2);">
          <input id="new-stage-name" type="text" style="flex: 1;" />
          <button type="button" class="button" style="width: auto; padding-left: var(--space-4); padding-right: var(--space-4);" data-add-stage>Add</button>
        </div>
        <p class="error-text" data-stage-error hidden></p>
      `;

      for (const s of stages) {
        const input = mount.querySelector(`[data-stage-input="${s.id}"]`);
        input.value = s.stage_name;
        input.addEventListener('blur', async () => {
          const newName = input.value.trim();
          if (!newName || newName === s.stage_name) {
            input.value = s.stage_name; // revert an empty or no-op edit
            return;
          }
          const { error } = await supabase
            .from('product_workflow_stages')
            .update({ stage_name: newName })
            .eq('id', s.id);
          if (error) {
            showStageError(mount, error.message);
            input.value = s.stage_name;
          } else {
            s.stage_name = newName;
          }
        });
      }

      for (const button of mount.querySelectorAll('[data-move-up]:not([disabled])')) {
        button.addEventListener('click', () => moveStage(mount, productId, button.dataset.moveUp, -1));
      }
      for (const button of mount.querySelectorAll('[data-move-down]:not([disabled])')) {
        button.addEventListener('click', () => moveStage(mount, productId, button.dataset.moveDown, 1));
      }
      for (const button of mount.querySelectorAll('[data-remove-stage]')) {
        button.addEventListener('click', () => removeStage(mount, productId, button.dataset.removeStage));
      }

      mount.querySelector('[data-add-stage]').addEventListener('click', () => addStage(mount, productId));
    }

    function showStageError(mount, message) {
      const el = mount.querySelector('[data-stage-error]');
      if (el) {
        el.textContent = message;
        el.hidden = false;
      }
    }

    async function addStage(mount, productId) {
      const input = mount.querySelector('#new-stage-name');
      const name = input.value.trim();
      if (!name) {
        showStageError(mount, 'Enter a stage name.');
        return;
      }

      const nextOrder = stages.length > 0 ? Math.max(...stages.map((s) => s.stage_order)) + 1 : 1;
      const { error } = await supabase
        .from('product_workflow_stages')
        .insert({ product_id: productId, stage_order: nextOrder, stage_name: name });

      if (error) {
        showStageError(mount, error.message);
        return;
      }
      await loadStages(productId);
    }

    async function removeStage(mount, productId, stageId) {
      const { error } = await supabase.from('product_workflow_stages').delete().eq('id', stageId);
      if (error) {
        showStageError(mount, error.message);
        return;
      }
      await loadStages(productId);
    }

    async function moveStage(mount, productId, stageId, direction) {
      const index = stages.findIndex((s) => s.id === stageId);
      const neighborIndex = index + direction;
      if (index === -1 || neighborIndex < 0 || neighborIndex >= stages.length) return;

      const current = stages[index];
      const neighbor = stages[neighborIndex];

      // stage_order has both unique(product_id, stage_order) and
      // check(stage_order > 0) — swap through a temporary value that can't
      // collide with either of the two real ones, since setting one
      // straight to the other's value would violate uniqueness mid-swap.
      const TEMP_ORDER = 999999;

      const { error: e1 } = await supabase
        .from('product_workflow_stages')
        .update({ stage_order: TEMP_ORDER })
        .eq('id', current.id);
      if (e1) {
        showStageError(mount, e1.message);
        return;
      }

      const { error: e2 } = await supabase
        .from('product_workflow_stages')
        .update({ stage_order: current.stage_order })
        .eq('id', neighbor.id);
      if (e2) {
        showStageError(mount, e2.message);
        return;
      }

      const { error: e3 } = await supabase
        .from('product_workflow_stages')
        .update({ stage_order: neighbor.stage_order })
        .eq('id', current.id);
      if (e3) {
        showStageError(mount, e3.message);
        return;
      }

      await loadStages(productId);
    }
  }
}

// --- small helpers -----------------------------------------------------------

function formatMoney(amount) {
  return `₱${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
