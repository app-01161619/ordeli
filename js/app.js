import { supabase } from "./supabase.js";


// =====================================
// DOM ELEMENTS
// =====================================

const loginScreen = document.getElementById("loginScreen");
const registerScreen = document.getElementById("registerScreen");
const homeScreen = document.getElementById("homeScreen");

const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");

const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");

const registerEmail = document.getElementById("registerEmail");
const registerPassword = document.getElementById("registerPassword");
const registerConfirmPassword =
  document.getElementById("registerConfirmPassword");

const loginButton = document.getElementById("loginButton");
const registerButton = document.getElementById("registerButton");

const loginMessage = document.getElementById("loginMessage");
const registerMessage = document.getElementById("registerMessage");

const currentUserEmail =
  document.getElementById("currentUserEmail");

const logoutButton =
  document.getElementById("logoutButton");


// =====================================
// ROUTING
// =====================================

function getRoute() {
  const route = window.location.hash.replace("#", "");

  if (
    route === "login" ||
    route === "register" ||
    route === "home"
  ) {
    return route;
  }

  return "login";
}


function showScreen(screen) {
  loginScreen.hidden = screen !== "login";
  registerScreen.hidden = screen !== "register";
  homeScreen.hidden = screen !== "home";
}


function navigate(route) {
  window.location.hash = route;
}


function renderRoute(session) {
  const requestedRoute = getRoute();

  if (session) {
    // Authenticated users belong in the application.
    // For Step 1, "home" is only a temporary screen.
    if (
      requestedRoute === "login" ||
      requestedRoute === "register"
    ) {
      navigate("home");
      return;
    }

    showScreen("home");
    return;
  }

  // No authenticated session.
  // Only login and register are available.
  if (requestedRoute === "register") {
    showScreen("register");
    return;
  }

  showScreen("login");
}


// =====================================
// SESSION
// =====================================

async function getCurrentSession() {
  const {
    data,
    error
  } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
}


// =====================================
// REGISTER
// =====================================

registerForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    clearMessages();

    const email = registerEmail.value.trim();
    const password = registerPassword.value;
    const confirmPassword =
      registerConfirmPassword.value;

    if (password !== confirmPassword) {
      registerMessage.textContent =
        "Passwords do not match.";

      return;
    }

    registerButton.disabled = true;
    registerButton.textContent = "Creating...";

    try {

      const {
        data,
        error
      } = await supabase.auth.signUp({
        email,
        password
      });

      if (error) {
        throw error;
      }

      /*
       * Depending on your Supabase Email Confirmation
       * setting, a newly registered user may receive
       * either:
       *
       * 1. A session immediately
       * 2. No session until email confirmation
       */

      if (data.session) {

        navigate("home");

      } else {

        registerMessage.textContent =
          "Account created. Please check your email to confirm your account.";

      }

    } catch (error) {

      console.error(
        "Registration error:",
        error
      );

      registerMessage.textContent =
        error.message;

    } finally {

      registerButton.disabled = false;
      registerButton.textContent =
        "Create Account";

    }
  }
);


// =====================================
// LOGIN
// =====================================

loginForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    clearMessages();

    const email = loginEmail.value.trim();
    const password = loginPassword.value;

    loginButton.disabled = true;
    loginButton.textContent = "Logging in...";

    try {

      const {
        error
      } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        throw error;
      }

      navigate("home");

    } catch (error) {

      console.error(
        "Login error:",
        error
      );

      loginMessage.textContent =
        error.message;

    } finally {

      loginButton.disabled = false;
      loginButton.textContent = "Log In";

    }
  }
);


// =====================================
// LOGOUT
// =====================================

logoutButton.addEventListener(
  "click",
  async () => {

    logoutButton.disabled = true;
    logoutButton.textContent = "Logging out...";

    try {

      const {
        error
      } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      navigate("login");

    } catch (error) {

      console.error(
        "Logout error:",
        error
      );

      alert(
        "Unable to log out. Please try again."
      );

    } finally {

      logoutButton.disabled = false;
      logoutButton.textContent = "Log Out";

    }
  }
);


// =====================================
// AUTH STATE CHANGES
// =====================================

supabase.auth.onAuthStateChange(
  (_event, session) => {

    if (session?.user) {

      currentUserEmail.textContent =
        session.user.email || "";

    } else {

      currentUserEmail.textContent = "";

    }

    renderRoute(session);
  }
);


// =====================================
// HASH ROUTE CHANGES
// =====================================

window.addEventListener(
  "hashchange",
  async () => {

    try {

      const session =
        await getCurrentSession();

      renderRoute(session);

    } catch (error) {

      console.error(
        "Route/session error:",
        error
      );

      showScreen("login");
    }
  }
);


// =====================================
// CLEAN MESSAGES
// =====================================

function clearMessages() {
  loginMessage.textContent = "";
  registerMessage.textContent = "";
}


// =====================================
// INITIALIZE APPLICATION
// =====================================

async function initializeApp() {

  try {

    const session =
      await getCurrentSession();

    if (session?.user) {

      currentUserEmail.textContent =
        session.user.email || "";

    }

    renderRoute(session);

  } catch (error) {

    console.error(
      "Application initialization failed:",
      error
    );

    showScreen("login");
  }
}


initializeApp();