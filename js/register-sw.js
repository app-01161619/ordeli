if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js?v=2026-09-13-03");
      try { await registration.update(); } catch (_) {}
    } catch (_) {}
  });
}
