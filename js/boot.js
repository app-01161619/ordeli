(() => {
  const fallback = document.getElementById("bootFallback");
  const showLoginError = (error) => {
    fallback?.classList.add("is-hidden");
    const screens = document.querySelectorAll(".screen");
    screens.forEach((screen) => { screen.hidden = screen.id !== "loginScreen"; });
    const message = document.getElementById("loginMessage");
    if (message) {
      const detail = error?.message ? ` ${error.message}` : "";
      message.textContent = `The app could not finish loading.${detail}`;
    }
    console.error("Ordeli application boot failed:", error);
  };

  const timeoutId = window.setTimeout(() => {
    const hasVisibleScreen = Array.from(document.querySelectorAll(".screen")).some((screen) => !screen.hidden);
    if (!hasVisibleScreen) {
      showLoginError(new Error("Startup timed out. Please reload the page."));
    }
  }, 10000);

  import("./app.js?v=2026-09-10-02")
    .then(() => {
      window.clearTimeout(timeoutId);
    })
    .catch((error) => {
      window.clearTimeout(timeoutId);
      showLoginError(error);
    });
})();
