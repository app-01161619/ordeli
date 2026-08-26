import { supabase } from "./supabase.js";


// ============================================
// DOM
// ============================================

const loginScreen =
  document.getElementById("loginScreen");

const registerScreen =
  document.getElementById("registerScreen");

const shopProfileScreen =
  document.getElementById("shopProfileScreen");

const homeScreen =
  document.getElementById("homeScreen");


const loginForm =
  document.getElementById("loginForm");

const registerForm =
  document.getElementById("registerForm");

const shopProfileForm =
  document.getElementById("shopProfileForm");


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


const shopName =
  document.getElementById("shopName");

const shopAddress =
  document.getElementById("shopAddress");

const shopLogo =
  document.getElementById("shopLogo");

const shopLogoPreviewContainer =
  document.getElementById(
    "shopLogoPreviewContainer"
  );

const shopLogoPreview =
  document.getElementById("shopLogoPreview");


const loginButton =
  document.getElementById("loginButton");

const registerButton =
  document.getElementById("registerButton");

const saveShopProfileButton =
  document.getElementById(
    "saveShopProfileButton"
  );


const loginMessage =
  document.getElementById("loginMessage");

const registerMessage =
  document.getElementById(
    "registerMessage"
  );

const shopProfileMessage =
  document.getElementById(
    "shopProfileMessage"
  );


const homeShopName =
  document.getElementById(
    "homeShopName"
  );

const homeShopAddress =
  document.getElementById(
    "homeShopAddress"
  );


const logoutButton =
  document.getElementById(
    "logoutButton"
  );

const shopProfileLogoutButton =
  document.getElementById(
    "shopProfileLogoutButton"
  );

const editShopProfileButton =
  document.getElementById(
    "editShopProfileButton"
  );


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
    route === "shop-profile" ||
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

  shopProfileScreen.hidden =
    route !== "shop-profile";

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
// LOAD PROFILE
// ============================================

async function loadSellerProfile(userId) {

  const {
    data,
    error
  } =
    await supabase
      .from("seller_profiles")
      .select(`
        shop_name,
        shop_address,
        shop_logo_path
      `)
      .eq("id", userId)
      .single();


  if (error) {
    throw error;
  }


  return data;
}


// ============================================
// PROFILE COMPLETION
// ============================================

function isShopProfileComplete(profile) {

  return Boolean(
    profile?.shop_name?.trim() &&
    profile?.shop_address?.trim()
  );
}


// ============================================
// RENDER APPLICATION
// ============================================

async function renderApplication() {

  const session =
    await getSession();


  if (!session) {

    if (
      getRoute() === "register"
    ) {

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


  if (
    !isShopProfileComplete(profile)
  ) {

    populateShopProfile(profile);

    showScreen("shop-profile");

    return;
  }


  homeShopName.textContent =
    profile.shop_name;

  homeShopAddress.textContent =
    profile.shop_address;


  if (
    getRoute() === "shop-profile"
  ) {

    populateShopProfile(profile);

    showScreen("shop-profile");

    return;
  }


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


    const name =
      registerShopName.value.trim();

    const password =
      registerPassword.value;

    const confirmPassword =
      registerConfirmPassword.value;


    if (name.length < 2) {

      registerMessage.textContent =
        "Shop name must be at least 2 characters.";

      return;
    }


    if (password.length < 8) {

      registerMessage.textContent =
        "Password must be at least 8 characters.";

      return;
    }


    if (
      password !== confirmPassword
    ) {

      registerMessage.textContent =
        "Passwords do not match.";

      return;
    }


    registerButton.disabled = true;

    registerButton.textContent =
      "Creating...";


    try {

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

              shop_name: name,

              login_identifier:
                internalEmail

            }

          }

        });


      if (error) {
        throw error;
      }


      if (!data.session) {

        throw new Error(
          "Account was created but no session was returned. Check that email confirmation is disabled."
        );

      }


      navigate("shop-profile");

    } catch (error) {

      console.error(
        "Registration failed:",
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


// ============================================
// LOGIN
// ============================================

loginForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    clearMessages();


    const name =
      loginShopName.value.trim();

    const password =
      loginPassword.value;


    loginButton.disabled = true;

    loginButton.textContent =
      "Logging in...";


    try {

      const {
        data,
        error
      } =
        await supabase.rpc(
          "get_login_identifier",
          {
            requested_shop_name:
              name
          }
        );


      if (error) {
        throw error;
      }


      if (!data) {

        throw new Error(
          "Invalid credentials."
        );

      }


      const {
        error: loginError
      } =
        await supabase.auth
          .signInWithPassword({

            email: data,

            password

          });


      if (loginError) {
        throw loginError;
      }


      await renderApplication();

    } catch (error) {

      console.error(
        "Login failed:",
        error
      );


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
// SHOP PROFILE
// ============================================

shopProfileForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    shopProfileMessage.textContent =
      "";


    const session =
      await getSession();


    if (!session) {

      navigate("login");

      return;
    }


    const name =
      shopName.value.trim();

    const address =
      shopAddress.value.trim();

    const selectedLogo =
      shopLogo.files[0];


    if (name.length < 2) {

      shopProfileMessage.textContent =
        "Shop name must be at least 2 characters.";

      return;
    }


    if (!address) {

      shopProfileMessage.textContent =
        "Shop address is required.";

      return;
    }


    saveShopProfileButton.disabled = true;

    saveShopProfileButton.textContent =
      "Saving...";


    try {

      let logoPath = null;


      /*
       * Keep the existing logo if the
       * seller does not choose a new one.
       */

      const existingProfile =
        await loadSellerProfile(
          session.user.id
        );


      logoPath =
        existingProfile.shop_logo_path;


      // ------------------------------
      // Upload new logo
      // ------------------------------

      if (selectedLogo) {

        const allowedTypes = [
          "image/png",
          "image/jpeg",
          "image/webp"
        ];


        if (
          !allowedTypes.includes(
            selectedLogo.type
          )
        ) {

          throw new Error(
            "Please choose a PNG, JPEG, or WebP image."
          );

        }


        const maxSize =
          5 * 1024 * 1024;


        if (
          selectedLogo.size > maxSize
        ) {

          throw new Error(
            "Shop logo must be 5 MB or smaller."
          );

        }


        const extension =
          getFileExtension(
            selectedLogo.name
          );


        const fileName =
          `${crypto.randomUUID()}.${extension}`;


        const filePath =
          `${session.user.id}/${fileName}`;


        const {
          error: uploadError
        } =
          await supabase
            .storage
            .from("shop-logos")
            .upload(
              filePath,
              selectedLogo,
              {
                contentType:
                  selectedLogo.type,

                cacheControl:
                  "3600",

                upsert: false
              }
            );


        if (uploadError) {
          throw uploadError;
        }


        logoPath =
          filePath;


        /*
         * Delete the old logo only after
         * the new one has uploaded successfully.
         */

        if (
          existingProfile.shop_logo_path &&
          existingProfile.shop_logo_path !==
            logoPath
        ) {

          await supabase
            .storage
            .from("shop-logos")
            .remove([
              existingProfile.shop_logo_path
            ]);

        }

      }


      // ------------------------------
      // Update database
      // ------------------------------

      const {
        error: updateError
      } =
        await supabase
          .from("seller_profiles")
          .update({

            shop_name: name,

            shop_address: address,

            shop_logo_path: logoPath

          })
          .eq(
            "id",
            session.user.id
          );


      if (updateError) {
        throw updateError;
      }


      await renderApplication();


    } catch (error) {

      console.error(
        "Shop profile save failed:",
        error
      );


      shopProfileMessage.textContent =
        error.message ||
        "Unable to save shop profile.";

    } finally {

      saveShopProfileButton.disabled = false;

      saveShopProfileButton.textContent =
        "Save Shop Profile";

    }

  }
);


// ============================================
// LOGO PREVIEW
// ============================================

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


    const previewUrl =
      URL.createObjectURL(file);


    shopLogoPreview.src =
      previewUrl;

    shopLogoPreviewContainer.hidden =
      false;

  }
);


// ============================================
// POPULATE SHOP PROFILE
// ============================================

function populateShopProfile(profile) {

  shopName.value =
    profile?.shop_name || "";


  shopAddress.value =
    profile?.shop_address || "";


  shopLogo.value = "";


  shopLogoPreviewContainer.hidden =
    true;

}


// ============================================
// SHOP PROFILE NAVIGATION
// ============================================

editShopProfileButton.addEventListener(
  "click",
  () => {

    navigate("shop-profile");

  }
);


// ============================================
// LOGOUT
// ============================================

async function logout() {

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

  }

}


logoutButton.addEventListener(
  "click",
  logout
);


shopProfileLogoutButton.addEventListener(
  "click",
  logout
);


// ============================================
// AUTH STATE
// ============================================

supabase.auth.onAuthStateChange(
  async (_event, session) => {

    try {

      if (!session) {

        showScreen("login");

        return;
      }


      await renderApplication();

    } catch (error) {

      console.error(
        "Auth state error:",
        error
      );

      showScreen("login");

    }

  }
);


// ============================================
// ROUTING
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

  shopProfileMessage.textContent =
    "";

}


// ============================================
// FILE EXTENSION
// ============================================

function getFileExtension(fileName) {

  const parts =
    fileName.split(".");


  if (parts.length < 2) {
    return "jpg";
  }


  return parts
    .pop()
    .toLowerCase();

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