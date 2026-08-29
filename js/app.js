import { supabase } from "./supabase.js";

const screens = {
  login: document.getElementById("loginScreen"),
  register: document.getElementById("registerScreen"),
  setup: document.getElementById("shopSetupScreen"),
  home: document.getElementById("homeScreen")
};

const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const shopSetupForm = document.getElementById("shopSetupForm");

const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const registerEmail = document.getElementById("registerEmail");
const registerPassword = document.getElementById("registerPassword");
const registerConfirmPassword = document.getElementById("registerConfirmPassword");

const shopName = document.getElementById("shopName");
const shopAddress = document.getElementById("shopAddress");
const shopLogo = document.getElementById("shopLogo");
const shopLogoPreview = document.getElementById("shopLogoPreview");
const shopLogoPreviewContainer = document.getElementById("shopLogoPreviewContainer");

const loginMessage = document.getElementById("loginMessage");
const registerMessage = document.getElementById("registerMessage");
const shopSetupMessage = document.getElementById("shopSetupMessage");

const homeShopName = document.getElementById("homeShopName");
const homeShopAddress = document.getElementById("homeShopAddress");
const homeLogo = document.getElementById("homeLogo");
const homeLogoContainer = document.getElementById("homeLogoContainer");

const loginButton = document.getElementById("loginButton");
const registerButton = document.getElementById("registerButton");
const googleLoginButton = document.getElementById("googleLoginButton");
const googleRegisterButton = document.getElementById("googleRegisterButton");
const saveShopButton = document.getElementById("saveShopButton");

let isRendering = false;

function route() {
  const value = location.hash.replace("#", "").toLowerCase();
  return ["login","register","shop-setup","home"].includes(value) ? value : "login";
}

function navigate(value) {
  location.hash = value;
}

function show(routeName) {
  Object.values(screens).forEach(el => { el.hidden = true; });
  screens[routeName].hidden = false;
}

async function session() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function getSeller() {
  const { data, error } = await supabase
    .from("sellers")
    .select("id,email,login_method,google_id,shop_name,shop_address,shop_logo_path")
    .single();
  if (error) throw error;
  return data;
}

function complete(seller) {
  return Boolean(seller?.shop_name?.trim() && seller?.shop_address?.trim());
}

async function render() {
  if (isRendering) return;
  isRendering = true;

  try {
    const currentSession = await session();

    if (!currentSession) {
      show(route() === "register" ? "register" : "login");
      return;
    }

    const seller = await getSeller();

    if (!complete(seller)) {
      populateSetup(seller);
      show("setup");
      return;
    }

    await renderHome(seller);

  } catch (error) {
    console.error("Application render error:", error);
    show("login");
    loginMessage.textContent =
      error?.message ||
      "Unable to load the application. Check your Supabase configuration and database migration.";
  } finally {
    isRendering = false;
  }
}

function populateSetup(seller) {
  shopName.value = seller?.shop_name || "";
  shopAddress.value = seller?.shop_address || "";
  shopLogo.value = "";
  shopLogoPreview.removeAttribute("src");
  shopLogoPreviewContainer.hidden = true;
}

async function renderHome(seller) {
  homeShopName.textContent = seller.shop_name;
  homeShopAddress.textContent = seller.shop_address;

  homeLogoContainer.hidden = true;
  homeLogo.removeAttribute("src");

  if (seller.shop_logo_path) {
    const { data, error } = await supabase
      .storage
      .from("shop-logos")
      .createSignedUrl(seller.shop_logo_path, 3600);

    if (!error && data?.signedUrl) {
      homeLogo.src = data.signedUrl;
      homeLogoContainer.hidden = false;
    }
  }

  show("home");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessages();
  setLoading(loginButton, true, "Logging in...");

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.value.trim().toLowerCase(),
      password: loginPassword.value
    });
    if (error) throw error;
    await render();
  } catch (error) {
    console.error(error);
    loginMessage.textContent = authMessage(error);
  } finally {
    setLoading(loginButton, false, "Log In");
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessages();

  const email = registerEmail.value.trim().toLowerCase();
  const password = registerPassword.value;
  const confirm = registerConfirmPassword.value;

  if (password.length < 8) {
    registerMessage.textContent = "Password must be at least 8 characters.";
    return;
  }
  if (password !== confirm) {
    registerMessage.textContent = "Passwords do not match.";
    return;
  }

  setLoading(registerButton, true, "Creating...");

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });

    if (error) throw error;

    if (data.session) {
      navigate("shop-setup");
    } else {
      registerMessage.textContent =
        "Account created. Please confirm your email, then log in.";
    }
  } catch (error) {
    console.error(error);
    registerMessage.textContent = authMessage(error);
  } finally {
    setLoading(registerButton, false, "Create Account");
  }
});

async function googleAuth() {
  clearMessages();
  googleLoginButton.disabled = true;
  googleRegisterButton.disabled = true;

  try {
    const redirectTo =
      `${location.origin}${location.pathname}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });

    if (error) throw error;
  } catch (error) {
    console.error(error);
    const message = error?.message || "Unable to continue with Google.";
    if (route() === "register") registerMessage.textContent = message;
    else loginMessage.textContent = message;
    googleLoginButton.disabled = false;
    googleRegisterButton.disabled = false;
  }
}

googleLoginButton.addEventListener("click", googleAuth);
googleRegisterButton.addEventListener("click", googleAuth);

shopSetupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessages();

  const currentSession = await session();
  if (!currentSession) {
    navigate("login");
    return;
  }

  const name = shopName.value.trim();
  const address = shopAddress.value.trim();
  const logoFile = shopLogo.files[0];

  if (name.length < 2) {
    shopSetupMessage.textContent =
      "Shop name must be at least 2 characters.";
    return;
  }

  if (!address) {
    shopSetupMessage.textContent =
      "Shop address is required.";
    return;
  }

  setLoading(saveShopButton, true, "Saving...");

  try {
    const seller = await getSeller();
    let logoPath = seller.shop_logo_path;

    if (logoFile) {
      validateLogo(logoFile);

      const extension =
        logoFile.name.split(".").pop().toLowerCase();

      const path =
        `${currentSession.user.id}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase
        .storage
        .from("shop-logos")
        .upload(path, logoFile, {
          contentType: logoFile.type,
          cacheControl: "3600",
          upsert: false
        });

      if (uploadError) throw uploadError;

      logoPath = path;

      if (seller.shop_logo_path) {
        const { error: deleteError } = await supabase
          .storage
          .from("shop-logos")
          .remove([seller.shop_logo_path]);

        if (deleteError) {
          console.warn("Previous logo could not be removed:", deleteError);
        }
      }
    }

    const { error } = await supabase
      .from("sellers")
      .update({
        shop_name: name,
        shop_address: address,
        shop_logo_path: logoPath,
        updated_at: new Date().toISOString()
      });

    if (error) throw error;

    await syncGoogleIdentity();
    await render();

  } catch (error) {
    console.error(error);
    shopSetupMessage.textContent =
      error?.message || "Unable to save shop information.";
  } finally {
    setLoading(saveShopButton, false, "Save Shop");
  }
});

async function syncGoogleIdentity() {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return;

    const identity = data.user.identities?.find(
      entry => entry.provider === "google"
    );

    if (!identity?.identity_data?.sub) return;

    await supabase
      .from("sellers")
      .update({
        google_id: identity.identity_data.sub,
        login_method: "google",
        updated_at: new Date().toISOString()
      });
  } catch (error) {
    console.warn("Google identity sync skipped:", error);
  }
}

shopLogo.addEventListener("change", () => {
  const file = shopLogo.files[0];

  if (!file) {
    shopLogoPreviewContainer.hidden = true;
    shopLogoPreview.removeAttribute("src");
    return;
  }

  try {
    validateLogo(file);
    shopLogoPreview.src = URL.createObjectURL(file);
    shopLogoPreviewContainer.hidden = false;
  } catch (error) {
    shopLogo.value = "";
    shopLogoPreviewContainer.hidden = true;
    shopSetupMessage.textContent = error.message;
  }
});

document.getElementById("editShopButton").addEventListener(
  "click",
  () => navigate("shop-setup")
);

document.getElementById("homeLogoutButton").addEventListener(
  "click",
  signOut
);

document.getElementById("shopSetupLogoutButton").addEventListener(
  "click",
  signOut
);

async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    navigate("login");
  } catch (error) {
    console.error(error);
    alert("Unable to log out. Please try again.");
  }
}

supabase.auth.onAuthStateChange(() => {
  setTimeout(() => render(), 0);
});

window.addEventListener("hashchange", () => {
  render();
});

function clearMessages() {
  loginMessage.textContent = "";
  registerMessage.textContent = "";
  shopSetupMessage.textContent = "";
}

function setLoading(button, loading, text) {
  button.disabled = loading;
  button.textContent = text;
}

function validateLogo(file) {
  const types = ["image/png", "image/jpeg", "image/webp"];

  if (!types.includes(file.type)) {
    throw new Error("Shop logo must be PNG, JPEG, or WebP.");
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Shop logo must be 5 MB or smaller.");
  }
}

function authMessage(error) {
  const message = String(error?.message || "");

  if (
    message.toLowerCase().includes("invalid login credentials")
  ) {
    return "Invalid email or password.";
  }

  if (
    message.toLowerCase().includes("email not confirmed")
  ) {
    return "Please confirm your email before logging in.";
  }

  return message || "Authentication failed.";
}

render();
