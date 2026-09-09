(() => {
  const fallback = document.getElementById("bootFallback");
  const clearFallback = () => fallback?.classList.add("is-hidden");
  const hasVisibleScreen = () => Array.from(document.querySelectorAll(".screen")).some((screen) => !screen.hidden);

  // app.js normally hides the boot screen immediately. This watchdog only
  // prevents a broken module/service-worker response from leaving the PWA
  // permanently stuck on the boot screen.
  window.setTimeout(() => {
    if (hasVisibleScreen()) return;
    clearFallback();
    const login = document.getElementById("loginScreen");
    if (login) login.hidden = false;
    const message = document.getElementById("loginMessage");
    if (message) message.textContent = "The app could not finish loading. Please reload the page.";
  }, 8000);
})();
