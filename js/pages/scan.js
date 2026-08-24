import { supabase } from '../supabase-client.js';
import { getSession } from '../auth.js';
import { getMyShop } from '../shop.js';

// Loaded lazily (only when this page is actually opened) as a classic
// script, same reasoning as the Supabase UMD tag in index.html: jsQR is a
// tiny, dependency-free UMD build, and a plain <script> sidesteps any risk
// from jsDelivr's ESM conversion rather than trusting it for a second
// package. See README "Why the Supabase script tag looks unusual".
const JSQR_SRC = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

const ITEM_SELECT = `
  id,
  qr_code_id,
  quantity,
  products ( name ),
  orders ( id, customer_name ),
  order_item_stages ( id, stage_order, stage_name, status, finished_at, note )
`;

let activeStream = null;
let rafHandle = null;
let jsQRPromise = null;

/** Called by the router before it renders the next page (see router.js). */
export function onLeave() {
  stopCamera();
}

function stopCamera() {
  if (rafHandle) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  if (activeStream) {
    for (const track of activeStream.getTracks()) track.stop();
    activeStream = null;
  }
}

function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (jsQRPromise) return jsQRPromise;

  jsQRPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = JSQR_SRC;
    script.onload = () => resolve(window.jsQR);
    script.onerror = () => reject(new Error('Could not load the QR scanner library.'));
    document.head.appendChild(script);
  });
  return jsQRPromise;
}

export async function render(container) {
  stopCamera(); // defensive — in case render() runs again without onLeave

  container.innerHTML = '';
  const screen = document.createElement('div');
  screen.className = 'screen';
  screen.innerHTML = '<h1 class="subtitle">Scan</h1><div data-body></div>';
  container.appendChild(screen);

  const body = screen.querySelector('[data-body]');

  const session = getSession();
  const { shop, role, memberId, error: shopError } = await getMyShop(session);

  if (shopError) {
    body.innerHTML = `<p class="error-text">${escapeHtml(shopError)}</p>`;
    return;
  }
  if (!shop) {
    body.innerHTML = '<p class="empty-state">Finish setting up your shop first.</p>';
    return;
  }

  setView({ name: 'starting' });

  // --- view state machine -------------------------------------------------

  function setView(next) {
    switch (next.name) {
      case 'starting':
        body.innerHTML = '<p class="text-secondary">Starting camera…</p>';
        startScanning();
        break;

      case 'scanning':
        renderScanning(next.stream, next.jsQR);
        break;

      case 'resolving':
        body.innerHTML = '<p class="text-secondary">Looking that up…</p>';
        break;

      case 'error':
        body.innerHTML = `
          <p class="error-text">${escapeHtml(next.message)}</p>
          <div class="button-row"><button type="button" class="button" data-retry>Try again</button></div>
        `;
        body.querySelector('[data-retry]').addEventListener('click', () => setView({ name: 'starting' }));
        break;

      case 'not-found':
        body.innerHTML = `
          <p class="empty-state">That code isn't recognized for this shop.</p>
          <div class="button-row"><button type="button" class="button" data-again>Scan another</button></div>
        `;
        body.querySelector('[data-again]').addEventListener('click', () => setView({ name: 'starting' }));
        break;

      case 'qr-state':
        body.innerHTML = `
          <p class="empty-state">${escapeHtml(next.message)}</p>
          <div class="button-row"><button type="button" class="button" data-again>Scan another</button></div>
        `;
        body.querySelector('[data-again]').addEventListener('click', () => setView({ name: 'starting' }));
        break;

      case 'item':
        renderItem(next.item);
        break;
    }
  }

  // --- camera + decode loop ------------------------------------------------

  async function startScanning() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setView({ name: 'error', message: 'Camera access is not available in this browser.' });
      return;
    }

    try {
      const [stream, jsQR] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }),
        loadJsQR(),
      ]);
      activeStream = stream;
      setView({ name: 'scanning', stream, jsQR });
    } catch (err) {
      setView({ name: 'error', message: cameraErrorMessage(err) });
    }
  }

  function renderScanning(stream, jsQR) {
    body.innerHTML = `
      <div class="scan-viewport">
        <video autoplay playsinline muted></video>
        <div class="scan-frame"></div>
      </div>
      <p class="scan-hint text-secondary">Point the camera at a QR code.</p>
    `;

    const video = body.querySelector('video');
    video.srcObject = stream;
    video.play().catch((err) => {
      stopCamera();
      setView({ name: 'error', message: cameraErrorMessage(err) });
    });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(frame.data, frame.width, frame.height);

        if (result?.data) {
          stopCamera();
          resolveScan(result.data);
          return;
        }
      }
      rafHandle = requestAnimationFrame(tick);
    };
    rafHandle = requestAnimationFrame(tick);
  }

  // --- resolving a scanned code against the database -----------------------

  async function resolveScan(scannedText) {
    setView({ name: 'resolving' });

    const token = extractToken(scannedText);

    const { data: qrRow, error: qrError } = await supabase
      .from('qr_codes')
      .select('id, status, display_code, revoked_reason')
      .eq('shop_id', shop.id)
      .eq('code_token', token)
      .maybeSingle();

    if (qrError) {
      setView({ name: 'error', message: qrError.message });
      return;
    }

    if (qrRow) {
      if (qrRow.status === 'assigned') {
        await loadItem('qr_code_id', qrRow.id);
        return;
      }
      if (qrRow.status === 'available') {
        setView({
          name: 'qr-state',
          message: `QR ${qrRow.display_code} hasn't been assigned to an order yet — order creation isn't built yet, so there's nothing to open.`,
        });
        return;
      }
      if (qrRow.status === 'released') {
        setView({
          name: 'qr-state',
          message: `QR ${qrRow.display_code} was released and isn't currently assigned to an order.`,
        });
        return;
      }
      // revoked
      setView({
        name: 'qr-state',
        message: `QR ${qrRow.display_code} was revoked${qrRow.revoked_reason ? `: ${qrRow.revoked_reason}` : '.'}`,
      });
      return;
    }

    // Not a seller-side token — might be a customer card instead (the two
    // start out identical but can diverge if a customer's card gets
    // regenerated later; see order_items.customer_tracking_token).
    await loadItem('customer_tracking_token', token, /* isFallback */ true);
  }

  async function loadItem(column, value, isFallback = false) {
    const { data: item, error } = await supabase
      .from('order_items')
      .select(ITEM_SELECT)
      .eq(column, value)
      .maybeSingle();

    if (error) {
      setView({ name: 'error', message: error.message });
      return;
    }
    if (!item) {
      if (isFallback) {
        setView({ name: 'not-found' });
      } else {
        // An assigned qr_codes row with no matching order_items row would
        // mean the two tables disagree — surface it plainly rather than
        // silently calling it "not found".
        setView({ name: 'error', message: 'This QR is marked assigned but no matching order item was found.' });
      }
      return;
    }
    setView({ name: 'item', item });
  }

  // --- order item detail + finish-stage action ------------------------------

  function renderItem(item) {
    const stages = [...item.order_item_stages].sort((a, b) => a.stage_order - b.stage_order);
    const nextStage = stages.find((s) => s.status === 'pending');

    const stageRows = stages
      .map((s) => {
        const cls = s.status === 'finished' ? 'finished' : nextStage?.id === s.id ? 'next' : 'pending';
        const meta =
          s.status === 'finished'
            ? `<p class="text-small text-secondary">${formatDate(s.finished_at)}${
                s.note ? ` · ${escapeHtml(s.note)}` : ''
              }</p>`
            : '';
        return `
          <div class="stage-row stage-row--${cls}">
            <span class="stage-row-icon">${s.status === 'finished' ? checkIcon() : circleIcon()}</span>
            <div>
              <p class="text-small-bold">${escapeHtml(s.stage_name)}</p>
              ${meta}
            </div>
          </div>
        `;
      })
      .join('');

    const finishBlock = nextStage
      ? `
        <div class="card stack" style="margin-top: var(--space-5);">
          <p class="text-small-bold">Finish: ${escapeHtml(nextStage.stage_name)}</p>
          <label for="stage-note">Note (optional)</label>
          <input id="stage-note" type="text" />
          <label for="stage-photo">Proof photo (optional)</label>
          <input id="stage-photo" type="file" accept="image/*" capture="environment" />
          <p class="error-text" data-finish-error hidden></p>
          <div class="button-row">
            <button type="button" class="button" data-finish>Mark finished</button>
          </div>
        </div>
      `
      : stages.length > 0
        ? '<p class="info-text" style="text-align: center;">All stages complete ✓</p>'
        : '<p class="empty-state">No production stages configured for this product.</p>';

    body.innerHTML = `
      <div class="card stack">
        <p class="text-small text-secondary">${escapeHtml(item.orders?.customer_name ?? 'Unknown customer')}</p>
        <p class="text-small-bold">${escapeHtml(item.products?.name ?? 'Unknown product')} × ${item.quantity}</p>
      </div>

      <div class="stack" style="margin-top: var(--space-5);">${stageRows}</div>

      ${finishBlock}

      <div class="button-row">
        <button type="button" class="button button--outline" data-again>Scan another</button>
      </div>
    `;

    body.querySelector('[data-again]').addEventListener('click', () => setView({ name: 'starting' }));

    if (nextStage) {
      body.querySelector('[data-finish]').addEventListener('click', () => finishStage(nextStage, item));
    }
  }

  async function finishStage(stage, item) {
    const noteInput = body.querySelector('#stage-note');
    const photoInput = body.querySelector('#stage-photo');
    const errorEl = body.querySelector('[data-finish-error]');
    const button = body.querySelector('[data-finish]');

    errorEl.hidden = true;
    button.disabled = true;
    button.textContent = 'Saving…';

    let proofPhotoUrl = null;
    const file = photoInput.files[0];

    if (file) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${shop.id}/${item.id}/${stage.id}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('production-photos')
        .upload(path, file, { contentType: file.type });

      if (uploadError) {
        errorEl.textContent = uploadError.message;
        errorEl.hidden = false;
        button.disabled = false;
        button.textContent = 'Mark finished';
        return;
      }
      proofPhotoUrl = path;
    }

    const { error } = await supabase
      .from('order_item_stages')
      .update({
        status: 'finished',
        note: noteInput.value.trim() || null,
        proof_photo_url: proofPhotoUrl,
        finished_by: role === 'production_member' ? memberId : null,
      })
      .eq('id', stage.id);

    if (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      button.disabled = false;
      button.textContent = 'Mark finished';
      return;
    }

    // Re-fetch so the stage list, item.production_status, and "all complete"
    // state all reflect what the triggers just recomputed server-side,
    // rather than guessing at it optimistically on the client.
    await loadItem('id', item.id);
  }
}

// --- small helpers -----------------------------------------------------------

// Accepts either a bare token or a URL ending in the token (the customer
// card is documented to carry a full tracking URL — see the business-rules
// doc's "QR written URL" section — so the seller card may end up printed
// the same way; support both rather than assuming one).
function extractToken(scannedText) {
  const trimmed = scannedText.trim();
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || trimmed;
  } catch {
    return trimmed;
  }
}

function cameraErrorMessage(err) {
  if (err?.name === 'NotAllowedError') {
    return 'Camera access was denied. Allow camera access in your browser settings, then try again.';
  }
  if (err?.name === 'NotFoundError') {
    return 'No camera was found on this device.';
  }
  if (err?.name === 'NotReadableError') {
    return 'The camera is already in use by another app.';
  }
  return err?.message || 'Could not start the camera.';
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function checkIcon() {
  return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8"/><path d="M6.5 10.5l2.5 2.5 4.5-5"/></svg>';
}

function circleIcon() {
  return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="8"/></svg>';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
