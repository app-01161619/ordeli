export async function render(container) {
  container.innerHTML = `
    <div class="screen">
      <h1 class="subtitle">Scan</h1>
      <p class="text-secondary">
        QR scanning plugs in here next, using the camera (getUserMedia) with a JS decoder
        (jsQR or a ZXing port) rather than the browser's native BarcodeDetector API —
        BarcodeDetector isn't supported in iOS Safari, and this needs to work on any phone
        a production team member is holding. It'll resolve a scanned code against the
        qr_codes table to open the matching order item.
      </p>
    </div>
  `;
}
