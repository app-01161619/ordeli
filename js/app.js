import { supabase } from "./supabase.js";


// ============================================
// DOM
// ============================================

const loginScreen =
  document.getElementById("loginScreen");

const registerScreen =
  document.getElementById("registerScreen");

const homeScreen =
  document.getElementById("homeScreen");


const loginForm =
  document.getElementById("loginForm");

const registerForm =
  document.getElementById("registerForm");


const loginShopName =
  document.getElementById("loginShopName");

const loginPassword =
  document.getElementById("loginPassword");


const registerShopName =
  document.getElementById("registerShopName");

const registerPassword =
  document.getElementById("registerPassword");

const registerConfirmPassword =
  document.getElementById(
    "registerConfirmPassword"
  );


const loginButton =
  document.getElementById("loginButton");

const registerButton =
  document.getElementById("registerButton");

const logoutButton =
  document.getElementById("logoutButton");


const loginMessage =
  document.getElementById("loginMessage");

const registerMessage =
  document.getElementById("registerMessage");


const homeShopName =
  document.getElementById("homeShopName");


// ============================================
// ROUTING
// ============================================

function getRoute() {

  const route =
    window.location.hash
      .replace("#", "")
      .toLowerCase();


  if (
    route === "login" ||
    route === "register" ||
    route === "home"
  ) {
    return route;
  }


  return "login";
}


function navigate(route) {

  window.location.hash = route;
}


function showScreen(route) {

  loginScreen.hidden =
    route !== "login";

  registerScreen.hidden =
    route !== "register";

  homeScreen.hidden =
    route !== "home";
}


// ============================================
// SESSION
// ============================================

async function getSession() {

  const {
    data,
    error
  } =
    await supabase.auth.getSession();


  if (error) {
    throw error;
  }


  return data.session;
}


// ============================================
// LOAD SELLER PROFILE
// ============================================

async function loadSellerProfile(userId) {

  const {
    data,
    error
  } =
    await supabase
      .from("seller_profiles")
      .select("shop_name")
      .eq("id", userId)
      .single();


  if (error) {
    throw error;
  }


  return data;
}


// ============================================
// RENDER ROUTE
// ============================================

async function renderApplication() {

  const session =
    await getSession();


  if (!session) {

    if (getRoute() === "register") {

      showScreen("register");

    } else {

      showScreen("login");

    }

    return;
  }


  const profile =
    await loadSellerProfile(
      session.user.id
    );


  homeShopName.textContent =
    profile.shop_name;


  showScreen("home");
}


// ============================================
// REGISTER
// ============================================

registerForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    clearMessages();


    const shopName =
      registerShopName.value.trim();

    const password =
      registerPassword.value;

    const confirmPassword =
      registerConfirmPassword.value;


    if (shopName.length < 2) {

      registerMessage.textContent =
        "Shop name must be at least 2 characters.";

      return;
    }


    if (password !== confirmPassword) {

      registerMessage.textContent =
        "Passwords do not match.";

      return;
    }


    if (password.length < 8) {

      registerMessage.textContent =
        "Password must be at least 8 characters.";

      return;
    }


    registerButton.disabled = true;

    registerButton.textContent =
      "Creating...";


    try {

      /*
       * Generate a private technical identity.
       *
       * The seller never sees this value.
       */

      const internalId =
        crypto.randomUUID();


      const internalEmail =
        `${internalId}@internal.invalid`;


      const {
        data,
        error
      } =
        await supabase.auth.signUp({

          email: internalEmail,

          password,

          options: {

            data: {

              shop_name: shopName,

              login_identifier:
                internalEmail

            }

          }

        });


      if (error) {
        throw error;
      }


      /*
       * Email confirmation must be disabled
       * in Supabase for this authentication
       * model.
       */

      if (!data.session) {

        throw new Error(
          "Account was created but no session was returned. Check that email confirmation is disabled in Supabase Auth."
        );

      }


      navigate("home");


    } catch (error) {

      console.error(
        "Registration failed:",
        error
      );


      registerMessage.textContent =
        getFriendlyAuthError(error);


    } finally {

      registerButton.disabled = false;

      registerButton.textContent =
        "Create Account";

    }

  }
);


// ============================================
// LOGIN
// ============================================

loginForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    clearMessages();


    const shopName =
      loginShopName.value.trim();

    const password =
      loginPassword.value;


    if (!shopName) {

      loginMessage.textContent =
        "Enter your shop name.";

      return;
    }


    loginButton.disabled = true;

    loginButton.textContent =
      "Logging in...";


    try {

      /*
       * Find the hidden Supabase
       * authentication identity.
       */

      const {
        data: loginData,
        error: lookupError
      } =
        await supabase.rpc(
          "get_login_identifier",
          {
            requested_shop_name:
              shopName
          }
        );


      if (lookupError) {
        throw lookupError;
      }


      if (!loginData) {

        throw new Error(
          "Invalid shop name or password."
        );

      }


      /*
       * Use the hidden identity with
       * Supabase's normal password auth.
       */

      const {
        error: loginError
      } =
        await supabase.auth.signInWithPassword({

          email: loginData,

          password

        });


      if (loginError) {
        throw loginError;
      }


      navigate("home");


    } catch (error) {

      console.error(
        "Login failed:",
        error
      );


      /*
       * Don't reveal whether the shop
       * exists.
       */

      loginMessage.textContent =
        "Invalid shop name or password.";


    } finally {

      loginButton.disabled = false;

      loginButton.textContent =
        "Log In";

    }

  }
);


// ============================================
// LOGOUT
// ============================================

logoutButton.addEventListener(
  "click",
  async () => {

    logoutButton.disabled = true;

    logoutButton.textContent =
      "Logging out...";


    try {

      const {
        error
      } =
        await supabase.auth.signOut();


      if (error) {
        throw error;
      }


      navigate("login");


    } catch (error) {

      console.error(
        "Logout failed:",
        error
      );


      alert(
        "Unable to log out. Please try again."
      );


    } finally {

      logoutButton.disabled = false;

      logoutButton.textContent =
        "Log Out";

    }

  }
);


// ============================================
// AUTH STATE CHANGES
// ============================================

supabase.auth.onAuthStateChange(
  async (_event, session) => {

    try {

      if (session) {

        await renderApplication();

      } else {

        showScreen("login");

      }

    } catch (error) {

      console.error(
        "Auth state handling failed:",
        error
      );

      showScreen("login");

    }

  }
);


// ============================================
// HASH NAVIGATION
// ============================================

window.addEventListener(
  "hashchange",
  async () => {

    try {

      await renderApplication();

    } catch (error) {

      console.error(
        "Navigation failed:",
        error
      );

      showScreen("login");

    }

  }
);


// ============================================
// CLEAR MESSAGES
// ============================================

function clearMessages() {

  loginMessage.textContent =
    "";

  registerMessage.textContent =
    "";

}


// ============================================
// ERROR MESSAGE
// ============================================

function getFriendlyAuthError(error) {

  const message =
    String(error?.message || "")
      .toLowerCase();


  if (
    message.includes("already registered") ||
    message.includes("already been registered")
  ) {

    return "Unable to create this account.";

  }


  return (
    error?.message ||
    "Unable to create the account."
  );

}


// ============================================
// INITIALIZE
// ============================================

async function initializeApp() {

  try {

    await renderApplication();

  } catch (error) {

    console.error(
      "Application initialization failed:",
      error
    );

    showScreen("login");

  }

}


initializeApp();