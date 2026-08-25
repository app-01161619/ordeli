// Shared camera + jsQR plumbing used by both js/pages/scan.js (universal
// scanner) and js/order-editor.js (per-item QR assignment during order
// creation, #19). What differs between those two call sites is what
// happens *after* a code is decoded, not the camera mechanics themselves —
// this module only owns getting frames off the camera and into a decoded
// string.

const JSQR_SRC = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

let jsQRPromise = null;

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

export function cameraErrorMessage(err) {
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

// Accepts either a bare token or a URL ending in the token — the customer
// card is documented to carry a full tracking URL (see the business-rules
// doc's "QR written URL" section), so the seller card may end up printed
// the same way. Support both rather than assuming one.
export function extractToken(scannedText) {
  const trimmed = scannedText.trim();
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Starts the camera into `videoEl` and decodes frames until either a QR is
 * found (calls `onDecode(text)` once and stops itself) or `.stop()` is
 * called externally (e.g. the caller navigated away). Returns `{ stop }`.
 * Throws (getUserMedia/jsQR-load rejection) if the camera can't start —
 * callers should catch this and route it through cameraErrorMessage.
 */
export async function startQrScanner(videoEl, onDecode) {
  const [stream, jsQR] = await Promise.all([
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }),
    loadJsQR(),
  ]);

  let rafHandle = null;
  let stopped = false;

  function stop() {
    if (stopped) return;
    stopped = true;
    if (rafHandle) cancelAnimationFrame(rafHandle);
    for (const track of stream.getTracks()) track.stop();
  }

  videoEl.srcObject = stream;
  try {
    await videoEl.play();
  } catch (err) {
    stop();
    throw err;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const tick = () => {
    if (stopped) return;
    if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(frame.data, frame.width, frame.height);

      if (result?.data) {
        stop();
        onDecode(result.data);
        return;
      }
    }
    rafHandle = requestAnimationFrame(tick);
  };
  rafHandle = requestAnimationFrame(tick);

  return { stop };
}
