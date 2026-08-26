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

const productsScreen =
  document.getElementById("productsScreen");


const loginForm =
  document.getElementById("loginForm");

const registerForm =
  document.getElementById("registerForm");

const shopProfileForm =
  document.getElementById("shopProfileForm");

const productForm =
  document.getElementById("productForm");


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


const productList =
  document.getElementById("productList");

const emptyProductsState =
  document.getElementById(
    "emptyProductsState"
  );

const productEditor =
  document.getElementById("productEditor");

const productEditorTitle =
  document.getElementById(
    "productEditorTitle"
  );

const productName =
  document.getElementById("productName");

const productPrice =
  document.getElementById("productPrice");


const loginButton =
  document.getElementById("loginButton");

const registerButton =
  document.getElementById("registerButton");

const saveShopProfileButton =
  document.getElementById(
    "saveShopProfileButton"
  );

const saveProductButton =
  document.getElementById(
    "saveProductButton"
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

const productMessage =
  document.getElementById(
    "productMessage"
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

const productsLogoutButton =
  document.getElementById(
    "productsLogoutButton"
  );

const editShopProfileButton =
  document.getElementById(
    "editShopProfileButton"
  );

const productsButton =
  document.getElementById(
    "productsButton"
  );

const productsBackButton =
  document.getElementById(
    "productsBackButton"
  );

const addProductButton =
  document.getElementById(
    "addProductButton"
  );

const emptyAddProductButton =
  document.getElementById(
    "emptyAddProductButton"
  );

const cancelProductButton =
  document.getElementById(
    "cancelProductButton"
  );


// ============================================
// STATE
// ============================================

let editingProductId = null;


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
    route === "home" ||
    route === "products"
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

  productsScreen.hidden =
    route !== "products";
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
// SELLER PROFILE
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


function isShopProfileComplete(profile) {

  return Boolean(
    profile?.shop_name?.trim() &&
    profile?.shop_address?.trim()
  );
}


// ============================================
// APPLICATION
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


  const route =
    getRoute();


  if (route === "products") {

    showScreen("products");

    await loadProducts();

    return;
  }


  if (route === "shop-profile") {

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


      const existingProfile =
        await loadSellerProfile(
          session.user.id
        );


      logoPath =
        existingProfile.shop_logo_path;


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
// SHOP LOGO PREVIEW
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
// PRODUCTS
// ============================================

async function loadProducts() {

  productList.innerHTML = "";

  emptyProductsState.hidden = true;


  const session =
    await getSession();


  if (!session) {

    navigate("login");

    return;

  }


  const {
    data,
    error
  } =
    await supabase
      .from("products")
      .select(`
        id,
        name,
        default_price,
        created_at,
        updated_at
      `)
      .eq(
        "seller_id",
        session.user.id
      )
      .order(
        "name",
        {
          ascending: true
        }
      );


  if (error) {
    throw error;
  }


  if (!data.length) {

    emptyProductsState.hidden =
      false;

    return;

  }


  for (const product of data) {

    productList.appendChild(
      createProductCard(product)
    );

  }

}


function createProductCard(product) {

  const card =
    document.createElement("article");

  card.className =
    "product-card";


  const info =
    document.createElement("div");

  info.className =
    "product-card-info";


  const title =
    document.createElement("h2");

  title.textContent =
    product.name;


  const price =
    document.createElement("p");

  price.className =
    "product-price";

  price.textContent =
    formatPrice(
      product.default_price
    );


  info.appendChild(title);

  info.appendChild(price);


  const actions =
    document.createElement("div");

  actions.className =
    "product-card-actions";


  const editButton =
    document.createElement("button");

  editButton.type =
    "button";

  editButton.className =
    "secondary-button";

  editButton.textContent =
    "Edit";


  editButton.addEventListener(
    "click",
    () => {

      openProductEditor(product);

    }
  );


  actions.appendChild(editButton);


  card.appendChild(info);

  card.appendChild(actions);


  return card;
}


// ============================================
// OPEN PRODUCT EDITOR
// ============================================

function openProductEditor(product = null) {

  clearProductMessage();


  if (product) {

    editingProductId =
      product.id;

    productEditorTitle.textContent =
      "Edit Product";

    productName.value =
      product.name;

    productPrice.value =
      Number(
        product.default_price
      ).toFixed(2);

  } else {

    editingProductId =
      null;

    productEditorTitle.textContent =
      "Add Product";

    productName.value =
      "";

    productPrice.value =
      "";

  }


  productEditor.hidden =
    false;


  productName.focus();

}


// ============================================
// CLOSE PRODUCT EDITOR
// ============================================

function closeProductEditor() {

  editingProductId =
    null;

  productEditor.hidden =
    true;

  productName.value =
    "";

  productPrice.value =
    "";

  clearProductMessage();

}


// ============================================
// ADD PRODUCT
// ============================================

addProductButton.addEventListener(
  "click",
  () => {

    openProductEditor();

  }
);


emptyAddProductButton.addEventListener(
  "click",
  () => {

    openProductEditor();

  }
);


// ============================================
// SAVE PRODUCT
// ============================================

productForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    clearProductMessage();


    const session =
      await getSession();


    if (!session) {

      navigate("login");

      return;

    }


    const name =
      productName.value.trim();


    const price =
      Number(
        productPrice.value
      );


    if (!name) {

      productMessage.textContent =
        "Product name is required.";

      return;

    }


    if (
      !Number.isFinite(price) ||
      price < 0
    ) {

      productMessage.textContent =
        "Enter a valid price.";

      return;

    }


    saveProductButton.disabled =
      true;

    saveProductButton.textContent =
      "Saving...";


    try {

      if (editingProductId) {

        const {
          error
        } =
          await supabase
            .from("products")
            .update({

              name,

              default_price:
                price,

              updated_at:
                new Date().toISOString()

            })
            .eq(
              "id",
              editingProductId
            )
            .eq(
              "seller_id",
              session.user.id
            );


        if (error) {
          throw error;
        }

      } else {

        const {
          error
        } =
          await supabase
            .from("products")
            .insert({

              seller_id:
                session.user.id,

              name,

              default_price:
                price

            });


        if (error) {
          throw error;
        }

      }


      closeProductEditor();

      await loadProducts();


    } catch (error) {

      console.error(
        "Product save failed:",
        error
      );


      productMessage.textContent =
        getProductErrorMessage(error);

    } finally {

      saveProductButton.disabled =
        false;

      saveProductButton.textContent =
        "Save Product";

    }

  }
);


// ============================================
// PRODUCT NAVIGATION
// ============================================

productsButton.addEventListener(
  "click",
  () => {

    navigate("products");

  }
);


productsBackButton.addEventListener(
  "click",
  () => {

    closeProductEditor();

    navigate("home");

  }
);


cancelProductButton.addEventListener(
  "click",
  () => {

    closeProductEditor();

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


    closeProductEditor();

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


productsLogoutButton.addEventListener(
  "click",
  logout
);


// ============================================
// PROFILE NAVIGATION
// ============================================

editShopProfileButton.addEventListener(
  "click",
  () => {

    navigate("shop-profile");

  }
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
// MESSAGES
// ============================================

function clearMessages() {

  loginMessage.textContent =
    "";

  registerMessage.textContent =
    "";

  shopProfileMessage.textContent =
    "";

}


function clearProductMessage() {

  productMessage.textContent =
    "";

}


// ============================================
// PRODUCT ERROR
// ============================================

function getProductErrorMessage(error) {

  if (
    error?.code === "42501"
  ) {

    return "You don't have permission to modify this product.";

  }


  return (
    error?.message ||
    "Unable to save product."
  );

}


// ============================================
// PRICE
// ============================================

function formatPrice(value) {

  const number =
    Number(value);


  return new Intl.NumberFormat(
    "en-PH",
    {
      style: "currency",
      currency: "PHP"
    }
  ).format(
    Number.isFinite(number)
      ? number
      : 0
  );

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