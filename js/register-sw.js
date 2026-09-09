if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js");
      try { await registration.update(); } catch (_) {}
    } catch (_) {}
  });
}
