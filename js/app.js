import { supabase } from "./supabase.js";

// ============================================================
// DOM
// ============================================================

const loginScreen = document.getElementById("loginScreen");
const registerScreen = document.getElementById("registerScreen");
const shopSetupScreen = document.getElementById("shopSetupScreen");
const homeScreen = document.getElementById("homeScreen");

const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const shopSetupForm = document.getElementById("shopSetupForm");

const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");

const registerEmail = document.getElementById("registerEmail");
const registerPassword = document.getElementById("registerPassword");
const registerConfirmPassword =
  document.getElementById("registerConfirmPassword");

const shopName = document.getElementById("shopName");
const shopAddress = document.getElementById("shopAddress");
const shopLogo = document.getElementById("shopLogo");

const shopLogoPreview =
  document.getElementById("shopLogoPreview");

const shopLogoPreviewContainer =
  document.getElementById("shopLogoPreviewContainer");

const loginButton =
  document.getElementById("loginButton");

const registerButton =
  document.getElementById("registerButton");

const googleLoginButton =
  document.getElementById("googleLoginButton");

const googleRegisterButton =
  document.getElementById("googleRegisterButton");

const saveShopButton =
  document.getElementById("saveShopButton");

const loginMessage =
  document.getElementById("loginMessage");

const registerMessage =
  document.getElementById("registerMessage");

const shopSetupMessage =
  document.getElementById("shopSetupMessage");

const homeShopName =
  document.getElementById("homeShopName");

const homeShopAddress =
  document.getElementById("homeShopAddress");

const homeLogo =
  document.getElementById("homeLogo");

const homeLogoContainer =
  document.getElementById("homeLogoContainer");

const editShopButton =
  document.getElementById("editShopButton");

const homeLogoutButton =
  document.getElementById("homeLogoutButton");

const shopSetupLogoutButton =
  document.getElementById("shopSetupLogoutButton");

// ============================================================
// ROUTING
// ============================================================

const validRoutes = [
  "login",
  "register",
  "shop-setup",
  "home"
];

function getRoute() {
  const value =
    window.location.hash
      .replace("#", "")
      .toLowerCase();

  return validRoutes.includes(value)
    ? value
    : "login";
}

function navigate(route) {
  if (window.location.hash === `#${route}`) {
    renderApplication();
    return;
  }

  window.location.hash = route;
}

function showScreen(route) {
  loginScreen.hidden = route !== "login";
  registerScreen.hidden = route !== "register";
  shopSetupScreen.hidden = route !== "shop-setup";
  homeScreen.hidden = route !== "home";
}

// ============================================================
// AUTH / SELLER DATA
// ============================================================

async function getSession() {
  const { data, error } =
    await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
}

async function getCurrentUser() {
  const { data, error } =
    await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error("No authenticated user.");
  }

  return data.user;
}

async function getSellerById(userId) {
  const { data, error } =
    await supabase
      .from("sellers")
      .select(`
        id,
        email,
        login_method,
        google_id,
        shop_name,
        shop_address,
        shop_logo_path,
        created_at,
        updated_at
      `)
      .eq("id", userId)
      .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function getCurrentSeller() {
  const user = await getCurrentUser();
  const seller = await getSellerById(user.id);

  if (!seller) {
    throw new Error(
      "Seller profile was not found. Make sure the seller database schema has been run, then sign in again."
    );
  }

  return seller;
}

function isShopComplete(seller) {
  return Boolean(
    seller?.shop_name?.trim() &&
    seller?.shop_address?.trim()
  );
}

// ============================================================
// APPLICATION
// ============================================================

async function renderApplication() {
  try {
    const currentSession = await getSession();

    if (!currentSession) {
      showScreen(
        getRoute() === "register"
          ? "register"
          : "login"
      );
      return;
    }

    const seller =
      await getSellerById(
        currentSession.user.id
      );

    if (!seller) {
      throw new Error(
        "Seller profile was not found. Make sure the seller database schema has been run, then sign in again."
      );
    }

    if (!isShopComplete(seller)) {
      populateShopForm(seller);
      showScreen("shop-setup");
      return;
    }

    await renderHome(seller);
  } catch (error) {
    console.error(
      "Application render error:",
      error
    );

    showScreen("login");

    loginMessage.textContent =
      error?.message ||
      "Unable to load the application.";
  }
}

// ============================================================
// HOME
// ============================================================

async function renderHome(seller) {
  homeShopName.textContent =
    seller.shop_name;

  homeShopAddress.textContent =
    seller.shop_address;

  await loadHomeLogo(
    seller.shop_logo_path
  );

  showScreen("home");
}

async function loadHomeLogo(logoPath) {
  homeLogoContainer.hidden = true;
  homeLogo.removeAttribute("src");

  if (!logoPath) {
    return;
  }

  const { data, error } =
    await supabase
      .storage
      .from("shop-logos")
      .createSignedUrl(
        logoPath,
        60 * 60
      );

  if (error) {
    console.warn(
      "Unable to load shop logo:",
      error
    );
    return;
  }

  if (data?.signedUrl) {
    homeLogo.src = data.signedUrl;
    homeLogoContainer.hidden = false;
  }
}

// ============================================================
// REGISTER
// ============================================================

registerForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    clearMessages();

    const email =
      registerEmail.value
        .trim()
        .toLowerCase();

    const password =
      registerPassword.value;

    const confirmPassword =
      registerConfirmPassword.value;

    if (!email) {
      registerMessage.textContent =
        "Email is required.";
      return;
    }

    if (password.length < 8) {
      registerMessage.textContent =
        "Password must be at least 8 characters.";
      return;
    }

    if (password !== confirmPassword) {
      registerMessage.textContent =
        "Passwords do not match.";
      return;
    }

    setButtonLoading(
      registerButton,
      "Creating..."
    );

    try {
      const { data, error } =
        await supabase.auth.signUp({
          email,
          password
        });

      if (error) {
        throw error;
      }

      if (data.session) {
        navigate("shop-setup");
        return;
      }

      registerMessage.textContent =
        "Account created. Please check your email to confirm your account, then log in.";
    } catch (error) {
      console.error(
        "Registration failed:",
        error
      );

      registerMessage.textContent =
        getAuthErrorMessage(error);
    } finally {
      resetButton(
        registerButton,
        "Create Account"
      );
    }
  }
);

// ============================================================
// LOGIN
// ============================================================

loginForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    clearMessages();

    const email =
      loginEmail.value
        .trim()
        .toLowerCase();

    const password =
      loginPassword.value;

    if (!email) {
      loginMessage.textContent =
        "Email is required.";
      return;
    }

    setButtonLoading(
      loginButton,
      "Logging in..."
    );

    try {
      const { error } =
        await supabase.auth
          .signInWithPassword({
            email,
            password
          });

      if (error) {
        throw error;
      }

      await renderApplication();
    } catch (error) {
      console.error(
        "Login failed:",
        error
      );

      loginMessage.textContent =
        getAuthErrorMessage(error);
    } finally {
      resetButton(
        loginButton,
        "Log In"
      );
    }
  }
);

// ============================================================
// GOOGLE AUTH
// ============================================================

async function signInWithGoogle() {
  clearMessages();

  googleLoginButton.disabled = true;
  googleRegisterButton.disabled = true;

  try {
    const redirectTo =
      `${window.location.origin}${window.location.pathname}`;

    const { error } =
      await supabase.auth
        .signInWithOAuth({
          provider: "google",
          options: {
            redirectTo
          }
        });

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error(
      "Google authentication failed:",
      error
    );

    const message =
      error?.message ||
      "Unable to continue with Google.";

    if (getRoute() === "register") {
      registerMessage.textContent =
        message;
    } else {
      loginMessage.textContent =
        message;
    }

    googleLoginButton.disabled = false;
    googleRegisterButton.disabled = false;
  }
}

googleLoginButton.addEventListener(
  "click",
  signInWithGoogle
);

googleRegisterButton.addEventListener(
  "click",
  signInWithGoogle
);

// ============================================================
// SHOP SETUP
// ============================================================

shopSetupForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    clearMessages();

    let currentUser;

    try {
      currentUser =
        await getCurrentUser();
    } catch (error) {
      shopSetupMessage.textContent =
        error?.message ||
        "Your session is no longer available.";

      return;
    }

    const name =
      shopName.value.trim();

    const address =
      shopAddress.value.trim();

    const logoFile =
      shopLogo.files[0];

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

    setButtonLoading(
      saveShopButton,
      "Saving..."
    );

    try {
      const seller =
        await getSellerById(
          currentUser.id
        );

      if (!seller) {
        throw new Error(
          "Seller profile was not found. Please sign out and sign in again."
        );
      }

      let logoPath =
        seller.shop_logo_path;

      // --------------------------------------
      // Upload new logo
      // --------------------------------------

      if (logoFile) {
        validateLogoFile(logoFile);

        const extension =
          getSafeExtension(
            logoFile.name
          );

        const filePath =
          `${currentUser.id}/${crypto.randomUUID()}.${extension}`;

        const { error: uploadError } =
          await supabase
            .storage
            .from("shop-logos")
            .upload(
              filePath,
              logoFile,
              {
                contentType:
                  logoFile.type,
                cacheControl:
                  "3600",
                upsert:
                  false
              }
            );

        if (uploadError) {
          throw uploadError;
        }

        const oldLogoPath =
          logoPath;

        logoPath =
          filePath;

        if (oldLogoPath) {
          const {
            error: deleteError
          } =
            await supabase
              .storage
              .from("shop-logos")
              .remove([
                oldLogoPath
              ]);

          if (deleteError) {
            console.warn(
              "Previous logo could not be removed:",
              deleteError
            );
          }
        }
      }

      // --------------------------------------
      // IMPORTANT:
      // The seller ID is explicitly supplied
      // in the UPDATE filter.
      // --------------------------------------

      const {
        data: updatedSeller,
        error: updateError
      } =
        await supabase
          .from("sellers")
          .update({
            shop_name:
              name,

            shop_address:
              address,

            shop_logo_path:
              logoPath,

            updated_at:
              new Date()
                .toISOString()
          })
          .eq(
            "id",
            currentUser.id
          )
          .select()
          .single();

      if (updateError) {
        throw updateError;
      }

      if (!updatedSeller) {
        throw new Error(
          "Shop profile was not updated."
        );
      }

      await syncGoogleIdentity(
        currentUser
      );

      await renderApplication();
    } catch (error) {
      console.error(
        "Shop setup failed:",
        error
      );

      shopSetupMessage.textContent =
        error?.message ||
        "Unable to save shop information.";
    } finally {
      resetButton(
        saveShopButton,
        "Save Shop"
      );
    }
  }
);

// ============================================================
// GOOGLE IDENTITY SYNC
// ============================================================

async function syncGoogleIdentity(
  currentUser
) {
  try {
    const googleIdentity =
      currentUser.identities?.find(
        (identity) =>
          identity.provider === "google"
      );

    if (
      !googleIdentity
        ?.identity_data
        ?.sub
    ) {
      return;
    }

    const { error } =
      await supabase
        .from("sellers")
        .update({
          google_id:
            googleIdentity
              .identity_data
              .sub,

          login_method:
            "google",

          updated_at:
            new Date()
              .toISOString()
        })
        .eq(
          "id",
          currentUser.id
        );

    if (error) {
      console.warn(
        "Google identity sync failed:",
        error
      );
    }
  } catch (error) {
    console.warn(
      "Google identity sync skipped:",
      error
    );
  }
}

// ============================================================
// LOGO PREVIEW
// ============================================================

shopLogo.addEventListener(
  "change",
  () => {
    const file =
      shopLogo.files[0];

    if (!file) {
      shopLogoPreviewContainer.hidden =
        true;

      shopLogoPreview.removeAttribute(
        "src"
      );

      return;
    }

    try {
      validateLogoFile(file);

      shopSetupMessage.textContent =
        "";

      shopLogoPreview.src =
        URL.createObjectURL(file);

      shopLogoPreviewContainer.hidden =
        false;
    } catch (error) {
      shopLogo.value =
        "";

      shopLogoPreviewContainer.hidden =
        true;

      shopSetupMessage.textContent =
        error.message;
    }
  }
);

// ============================================================
// SHOP NAVIGATION
// ============================================================

editShopButton.addEventListener(
  "click",
  async () => {
    try {
      const seller =
        await getCurrentSeller();

      populateShopForm(
        seller
      );

      navigate(
        "shop-setup"
      );
    } catch (error) {
      console.error(
        "Unable to open shop profile:",
        error
      );
    }
  }
);

// ============================================================
// LOGOUT
// ============================================================

homeLogoutButton.addEventListener(
  "click",
  logout
);

shopSetupLogoutButton.addEventListener(
  "click",
  logout
);

async function logout() {
  try {
    const { error } =
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
  }
}

// ============================================================
// AUTH STATE
// ============================================================

supabase.auth.onAuthStateChange(
  (
    _event,
    currentSession
  ) => {
    setTimeout(
      () => {
        if (currentSession) {
          renderApplication();
        } else {
          showScreen(
            getRoute() === "register"
              ? "register"
              : "login"
          );
        }
      },
      0
    );
  }
);

// ============================================================
// HASH ROUTING
// ============================================================

window.addEventListener(
  "hashchange",
  () => {
    renderApplication();
  }
);

// ============================================================
// HELPERS
// ============================================================

function clearMessages() {
  loginMessage.textContent = "";
  registerMessage.textContent = "";
  shopSetupMessage.textContent = "";
}

function setButtonLoading(
  button,
  text
) {
  button.disabled = true;
  button.textContent = text;
}

function resetButton(
  button,
  text
) {
  button.disabled = false;
  button.textContent = text;
}

function validateLogoFile(file) {
  const allowedTypes = [
    "image/png",
    "image/jpeg",
    "image/webp"
  ];

  if (
    !allowedTypes.includes(
      file.type
    )
  ) {
    throw new Error(
      "Shop logo must be PNG, JPEG, or WebP."
    );
  }

  const maxSize =
    5 * 1024 * 1024;

  if (file.size > maxSize) {
    throw new Error(
      "Shop logo must be 5 MB or smaller."
    );
  }
}

function getSafeExtension(
  fileName
) {
  const extension =
    fileName
      .split(".")
      .pop()
      .toLowerCase();

  const allowed = [
    "png",
    "jpg",
    "jpeg",
    "webp"
  ];

  return allowed.includes(
    extension
  )
    ? extension
    : "jpg";
}

function populateShopForm(
  seller
) {
  shopName.value =
    seller?.shop_name || "";

  shopAddress.value =
    seller?.shop_address || "";

  shopLogo.value =
    "";

  shopLogoPreviewContainer.hidden =
    true;

  shopLogoPreview.removeAttribute(
    "src"
  );
}

function getAuthErrorMessage(
  error
) {
  const message =
    String(
      error?.message || ""
    );

  const lower =
    message.toLowerCase();

  if (
    lower.includes(
      "invalid login credentials"
    )
  ) {
    return "Invalid email or password.";
  }

  if (
    lower.includes(
      "email not confirmed"
    )
  ) {
    return "Please confirm your email before logging in.";
  }

  return (
    message ||
    "Authentication failed."
  );
}

// ============================================================
// INITIALIZE
// ============================================================

renderApplication();
