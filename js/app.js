import { supabase } from "./supabase.js";


// ============================================================
// DOM - SCREENS
// ============================================================

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

const workflowScreen =
  document.getElementById("workflowScreen");

const qrScreen =
  document.getElementById("qrScreen");

const qrPrintScreen =
  document.getElementById("qrPrintScreen");

const ordersScreen =
  document.getElementById("ordersScreen");


// ============================================================
// DOM - FORMS
// ============================================================

const loginForm =
  document.getElementById("loginForm");

const registerForm =
  document.getElementById("registerForm");

const shopProfileForm =
  document.getElementById("shopProfileForm");

const productForm =
  document.getElementById("productForm");

const qrSeriesForm =
  document.getElementById("qrSeriesForm");

const orderForm =
  document.getElementById("orderForm");


// ============================================================
// DOM - LOGIN / REGISTER
// ============================================================

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


// ============================================================
// DOM - SHOP PROFILE
// ============================================================

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
  document.getElementById(
    "shopLogoPreview"
  );


// ============================================================
// DOM - PRODUCTS
// ============================================================

const productList =
  document.getElementById(
    "productList"
  );

const emptyProductsState =
  document.getElementById(
    "emptyProductsState"
  );

const productEditor =
  document.getElementById(
    "productEditor"
  );

const productEditorTitle =
  document.getElementById(
    "productEditorTitle"
  );

const productName =
  document.getElementById(
    "productName"
  );

const productPrice =
  document.getElementById(
    "productPrice"
  );


// ============================================================
// DOM - WORKFLOW
// ============================================================

const workflowProductName =
  document.getElementById(
    "workflowProductName"
  );

const stageList =
  document.getElementById(
    "stageList"
  );

const emptyStagesState =
  document.getElementById(
    "emptyStagesState"
  );


// ============================================================
// DOM - QR MANAGEMENT
// ============================================================

const qrProduct =
  document.getElementById(
    "qrProduct"
  );

const qrSeriesName =
  document.getElementById(
    "qrSeriesName"
  );

const qrQuantity =
  document.getElementById(
    "qrQuantity"
  );

const qrSeriesList =
  document.getElementById(
    "qrSeriesList"
  );

const emptyQrState =
  document.getElementById(
    "emptyQrState"
  );


// ============================================================
// DOM - QR PRINT
// ============================================================

const printSeriesName =
  document.getElementById(
    "printSeriesName"
  );

const printSeriesInfo =
  document.getElementById(
    "printSeriesInfo"
  );

const printCardGrid =
  document.getElementById(
    "printCardGrid"
  );

const printCardsButton =
  document.getElementById(
    "printCardsButton"
  );

const closePrintButton =
  document.getElementById(
    "closePrintButton"
  );


// ============================================================
// DOM - ORDERS
// ============================================================

const orderList =
  document.getElementById(
    "orderList"
  );

const emptyOrdersState =
  document.getElementById(
    "emptyOrdersState"
  );

const orderEditor =
  document.getElementById(
    "orderEditor"
  );

const orderCustomerName =
  document.getElementById(
    "orderCustomerName"
  );

const orderCustomerPhone =
  document.getElementById(
    "orderCustomerPhone"
  );

const orderItems =
  document.getElementById(
    "orderItems"
  );

const emptyOrderItems =
  document.getElementById(
    "emptyOrderItems"
  );

const orderTotal =
  document.getElementById(
    "orderTotal"
  );

const orderMessage =
  document.getElementById(
    "orderMessage"
  );


// ============================================================
// DOM - HOME
// ============================================================

const homeShopName =
  document.getElementById(
    "homeShopName"
  );

const homeShopAddress =
  document.getElementById(
    "homeShopAddress"
  );


// ============================================================
// DOM - BUTTONS
// ============================================================

const loginButton =
  document.getElementById(
    "loginButton"
  );

const registerButton =
  document.getElementById(
    "registerButton"
  );

const saveShopProfileButton =
  document.getElementById(
    "saveShopProfileButton"
  );

const saveProductButton =
  document.getElementById(
    "saveProductButton"
  );

const saveWorkflowButton =
  document.getElementById(
    "saveWorkflowButton"
  );

const generateQrButton =
  document.getElementById(
    "generateQrButton"
  );

const saveOrderButton =
  document.getElementById(
    "saveOrderButton"
  );


// ============================================================
// DOM - MESSAGES
// ============================================================

const loginMessage =
  document.getElementById(
    "loginMessage"
  );

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

const workflowMessage =
  document.getElementById(
    "workflowMessage"
  );

const qrMessage =
  document.getElementById(
    "qrMessage"
  );


// ============================================================
// DOM - NAVIGATION
// ============================================================

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

const qrManagementButton =
  document.getElementById(
    "qrManagementButton"
  );

const qrManagementButtonFromProducts =
  document.getElementById(
    "qrManagementButtonFromProducts"
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

const workflowBackButton =
  document.getElementById(
    "workflowBackButton"
  );

const addStageButton =
  document.getElementById(
    "addStageButton"
  );

const emptyAddStageButton =
  document.getElementById(
    "emptyAddStageButton"
  );

const cancelWorkflowButton =
  document.getElementById(
    "cancelWorkflowButton"
  );

const qrBackButton =
  document.getElementById(
    "qrBackButton"
  );

const ordersButton =
  document.getElementById(
    "ordersButton"
  );

const ordersBackButton =
  document.getElementById(
    "ordersBackButton"
  );

const createOrderButton =
  document.getElementById(
    "createOrderButton"
  );

const emptyCreateOrderButton =
  document.getElementById(
    "emptyCreateOrderButton"
  );

const addOrderItemButton =
  document.getElementById(
    "addOrderItemButton"
  );

const cancelOrderButton =
  document.getElementById(
    "cancelOrderButton"
  );

const ordersLogoutButton =
  document.getElementById(
    "ordersLogoutButton"
  );


// ============================================================
// STATE
// ============================================================

let editingProductId = null;

let workflowProductId = null;

let workflowStages = [];

let printSeriesId = null;

let orderProducts = [];

let orderBuilderItems = [];


// ============================================================
// ROUTING
// ============================================================

function getRoute() {

  const route =
    window.location.hash
      .replace("#", "")
      .toLowerCase();


  const allowedRoutes = [
    "login",
    "register",
    "shop-profile",
    "home",
    "products",
    "workflow",
    "qr",
    "qr-print",
    "orders"
  ];


  if (
    allowedRoutes.includes(route)
  ) {

    return route;

  }


  return "login";

}


function navigate(route) {

  window.location.hash =
    route;

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

  workflowScreen.hidden =
    route !== "workflow";

  qrScreen.hidden =
    route !== "qr";

  qrPrintScreen.hidden =
    route !== "qr-print";

  ordersScreen.hidden =
    route !== "orders";

}


// ============================================================
// SESSION
// ============================================================

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


// ============================================================
// SELLER PROFILE
// ============================================================

async function loadSellerProfile(
  userId
) {

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
      .eq(
        "id",
        userId
      )
      .single();


  if (error) {
    throw error;
  }


  return data;

}


function isShopProfileComplete(
  profile
) {

  return Boolean(
    profile?.shop_name?.trim() &&
    profile?.shop_address?.trim()
  );

}


// ============================================================
// APPLICATION RENDER
// ============================================================

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
    !isShopProfileComplete(
      profile
    )
  ) {

    populateShopProfile(
      profile
    );

    showScreen(
      "shop-profile"
    );

    return;

  }


  homeShopName.textContent =
    profile.shop_name;

  homeShopAddress.textContent =
    profile.shop_address;


  const route =
    getRoute();


  // ------------------------------------------
  // PRODUCTS
  // ------------------------------------------

  if (
    route === "products"
  ) {

    showScreen("products");

    await loadProducts();

    return;

  }


  // ------------------------------------------
  // WORKFLOW
  // ------------------------------------------

  if (
    route === "workflow"
  ) {

    if (!workflowProductId) {

      navigate("products");

      return;

    }


    showScreen("workflow");

    await loadWorkflowStages();

    return;

  }


  // ------------------------------------------
  // QR MANAGEMENT
  // ------------------------------------------

  if (
    route === "qr"
  ) {

    showScreen("qr");

    await loadQrManagement();

    return;

  }


  // ------------------------------------------
  // QR PRINT
  // ------------------------------------------

  if (
    route === "qr-print"
  ) {

    if (!printSeriesId) {

      navigate("qr");

      return;

    }


    showScreen(
      "qr-print"
    );

    await loadPrintableQrCards();

    return;

  }


  // ------------------------------------------
  // ORDERS
  // ------------------------------------------

  if (
    route === "orders"
  ) {

    showScreen("orders");

    await loadOrders();

    return;

  }


  // ------------------------------------------
  // SHOP PROFILE
  // ------------------------------------------

  if (
    route === "shop-profile"
  ) {

    populateShopProfile(
      profile
    );

    showScreen(
      "shop-profile"
    );

    return;

  }


  // ------------------------------------------
  // HOME
  // ------------------------------------------

  showScreen("home");

}


// ============================================================
// REGISTER
// ============================================================

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


    if (
      name.length < 2
    ) {

      registerMessage.textContent =
        "Shop name must be at least 2 characters.";

      return;

    }


    if (
      password.length < 8
    ) {

      registerMessage.textContent =
        "Password must be at least 8 characters.";

      return;

    }


    if (
      password !==
      confirmPassword
    ) {

      registerMessage.textContent =
        "Passwords do not match.";

      return;

    }


    registerButton.disabled =
      true;

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

        email:
          internalEmail,

        password,

        options: {

          data: {

            shop_name:
              name,

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


      navigate(
        "shop-profile"
      );


    } catch (error) {

      console.error(
        "Registration failed:",
        error
      );


      registerMessage.textContent =
        error.message;


    } finally {

      registerButton.disabled =
        false;

      registerButton.textContent =
        "Create Account";

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


    const name =
      loginShopName.value.trim();

    const password =
      loginPassword.value;


    loginButton.disabled =
      true;

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
        error:
          loginError
      } =
      await supabase.auth
        .signInWithPassword({

          email:
            data,

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

      loginButton.disabled =
        false;

      loginButton.textContent =
        "Log In";

    }

  }
);


// ============================================================
// SHOP PROFILE
// ============================================================

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


    if (
      name.length < 2
    ) {

      shopProfileMessage.textContent =
        "Shop name must be at least 2 characters.";

      return;

    }


    if (!address) {

      shopProfileMessage.textContent =
        "Shop address is required.";

      return;

    }


    saveShopProfileButton.disabled =
      true;

    saveShopProfileButton.textContent =
      "Saving...";


    try {

      const existingProfile =
        await loadSellerProfile(
          session.user.id
        );


      let logoPath =
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
          5 *
          1024 *
          1024;


        if (
          selectedLogo.size >
          maxSize
        ) {

          throw new Error(
            "Shop logo must be 5 MB or smaller."
          );

        }


        const extension =
          getFileExtension(
            selectedLogo.name
          );


        const filePath =
          `${session.user.id}/${crypto.randomUUID()}.${extension}`;


        const {
          error:
            uploadError
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

              upsert:
                false

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
        error:
          updateError
      } =
      await supabase
        .from(
          "seller_profiles"
        )
        .update({

          shop_name:
            name,

          shop_address:
            address,

          shop_logo_path:
            logoPath

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

      saveShopProfileButton.disabled =
        false;

      saveShopProfileButton.textContent =
        "Save Shop Profile";

    }

  }
);


// ============================================================
// SHOP LOGO PREVIEW
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


    shopLogoPreview.src =
      URL.createObjectURL(
        file
      );

    shopLogoPreviewContainer.hidden =
      false;

  }
);


// ============================================================
// SHOP PROFILE POPULATION
// ============================================================

function populateShopProfile(
  profile
) {

  shopName.value =
    profile?.shop_name || "";

  shopAddress.value =
    profile?.shop_address || "";

  shopLogo.value =
    "";

  shopLogoPreviewContainer.hidden =
    true;

}


// ============================================================
// PRODUCTS
// ============================================================

async function loadProducts() {

  productList.innerHTML =
    "";

  emptyProductsState.hidden =
    true;


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
        ascending:
          true
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


  data.forEach(
    (product) => {

      productList.appendChild(
        createProductCard(
          product
        )
      );

    }
  );

}


function createProductCard(
  product
) {

  const card =
    document.createElement(
      "article"
    );

  card.className =
    "product-card";


  const info =
    document.createElement(
      "div"
    );

  info.className =
    "product-card-info";


  const title =
    document.createElement(
      "h2"
    );

  title.textContent =
    product.name;


  const price =
    document.createElement(
      "p"
    );

  price.className =
    "product-price";

  price.textContent =
    formatPrice(
      product.default_price
    );


  info.appendChild(
    title
  );

  info.appendChild(
    price
  );


  const actions =
    document.createElement(
      "div"
    );

  actions.className =
    "product-card-actions";


  const workflowButton =
    document.createElement(
      "button"
    );

  workflowButton.type =
    "button";

  workflowButton.textContent =
    "Workflow";


  workflowButton.addEventListener(
    "click",
    () => {

      openWorkflow(
        product
      );

    }
  );


  const editButton =
    document.createElement(
      "button"
    );

  editButton.type =
    "button";

  editButton.className =
    "secondary-button";

  editButton.textContent =
    "Edit";


  editButton.addEventListener(
    "click",
    () => {

      openProductEditor(
        product
      );

    }
  );


  actions.appendChild(
    workflowButton
  );

  actions.appendChild(
    editButton
  );


  card.appendChild(
    info
  );

  card.appendChild(
    actions
  );


  return card;

}


// ============================================================
// PRODUCT EDITOR
// ============================================================

function openProductEditor(
  product = null
) {

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


cancelProductButton.addEventListener(
  "click",
  () => {

    closeProductEditor();

  }
);


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
              new Date()
                .toISOString()

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
        error.message ||
        "Unable to save product.";


    } finally {

      saveProductButton.disabled =
        false;

      saveProductButton.textContent =
        "Save Product";

    }

  }
);


// ============================================================
// PRODUCT NAVIGATION
// ============================================================

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


// ============================================================
// WORKFLOW
// ============================================================

async function openWorkflow(
  product
) {

  workflowProductId =
    product.id;

  workflowProductName.textContent =
    product.name;


  clearWorkflowMessage();


  try {

    await loadWorkflowStages();

    navigate("workflow");

  } catch (error) {

    console.error(
      "Workflow loading failed:",
      error
    );


    workflowMessage.textContent =
      error.message ||
      "Unable to load production workflow.";

  }

}


async function loadWorkflowStages() {

  stageList.innerHTML =
    "";

  emptyStagesState.hidden =
    true;


  const {
    data,
    error
  } =
  await supabase
    .from(
      "production_stages"
    )
    .select(`
      id,
      name,
      stage_order
    `)
    .eq(
      "product_id",
      workflowProductId
    )
    .order(
      "stage_order",
      {
        ascending:
          true
      }
    );


  if (error) {
    throw error;
  }


  workflowStages =
    data.map(
      (stage) => ({

        id:
          stage.id,

        name:
          stage.name,

        stage_order:
          stage.stage_order

      })
    );


  renderWorkflowStages();

}


function renderWorkflowStages() {

  stageList.innerHTML =
    "";


  if (
    !workflowStages.length
  ) {

    emptyStagesState.hidden =
      false;

    return;

  }


  emptyStagesState.hidden =
    true;


  workflowStages.forEach(
    (
      stage,
      index
    ) => {

      stage.stage_order =
        index + 1;


      stageList.appendChild(
        createStageElement(
          stage,
          index
        )
      );

    }
  );

}


function createStageElement(
  stage,
  index
) {

  const item =
    document.createElement(
      "div"
    );

  item.className =
    "stage-item";


  const number =
    document.createElement(
      "div"
    );

  number.className =
    "stage-number";

  number.textContent =
    String(
      index + 1
    );


  const input =
    document.createElement(
      "input"
    );

  input.type =
    "text";

  input.className =
    "stage-name-input";

  input.value =
    stage.name;

  input.maxLength =
    100;

  input.placeholder =
    "Stage name";


  input.addEventListener(
    "input",
    () => {

      stage.name =
        input.value;

    }
  );


  const actions =
    document.createElement(
      "div"
    );

  actions.className =
    "stage-actions";


  const upButton =
    document.createElement(
      "button"
    );

  upButton.type =
    "button";

  upButton.className =
    "secondary-button stage-action-button";

  upButton.textContent =
    "↑";

  upButton.title =
    "Move up";

  upButton.disabled =
    index === 0;


  upButton.addEventListener(
    "click",
    () => {

      moveStage(
        index,
        -1
      );

    }
  );


  const downButton =
    document.createElement(
      "button"
    );

  downButton.type =
    "button";

  downButton.className =
    "secondary-button stage-action-button";

  downButton.textContent =
    "↓";

  downButton.title =
    "Move down";

  downButton.disabled =
    index ===
    workflowStages.length - 1;


  downButton.addEventListener(
    "click",
    () => {

      moveStage(
        index,
        1
      );

    }
  );


  const deleteButton =
    document.createElement(
      "button"
    );

  deleteButton.type =
    "button";

  deleteButton.className =
    "danger-button stage-action-button";

  deleteButton.textContent =
    "Remove";


  deleteButton.addEventListener(
    "click",
    () => {

      removeStage(
        index
      );

    }
  );


  actions.appendChild(
    upButton
  );

  actions.appendChild(
    downButton
  );

  actions.appendChild(
    deleteButton
  );


  item.appendChild(
    number
  );

  item.appendChild(
    input
  );

  item.appendChild(
    actions
  );


  return item;

}


function moveStage(
  index,
  direction
) {

  const newIndex =
    index +
    direction;


  if (
    newIndex < 0 ||
    newIndex >=
      workflowStages.length
  ) {

    return;

  }


  const current =
    workflowStages[index];


  workflowStages[index] =
    workflowStages[newIndex];

  workflowStages[newIndex] =
    current;


  renderWorkflowStages();

}


function removeStage(
  index
) {

  workflowStages.splice(
    index,
    1
  );


  renderWorkflowStages();

}


function addStage() {

  workflowStages.push({

    id:
      null,

    name:
      "",

    stage_order:
      workflowStages.length + 1

  });


  renderWorkflowStages();


  const inputs =
    document.querySelectorAll(
      ".stage-name-input"
    );


  inputs[
    inputs.length - 1
  ]?.focus();

}


addStageButton.addEventListener(
  "click",
  addStage
);


emptyAddStageButton.addEventListener(
  "click",
  addStage
);


// ============================================================
// SAVE WORKFLOW
// ============================================================

saveWorkflowButton.addEventListener(
  "click",
  async () => {

    clearWorkflowMessage();


    const session =
      await getSession();


    if (!session) {

      navigate("login");

      return;

    }


    const cleanedStages =
      workflowStages.map(
        (stage) => ({

          name:
            stage.name.trim()

        })
      );


    if (
      !cleanedStages.length
    ) {

      workflowMessage.textContent =
        "Add at least one production stage.";

      return;

    }


    if (
      cleanedStages.some(
        (stage) =>
          !stage.name
      )
    ) {

      workflowMessage.textContent =
        "Every production stage needs a name.";

      return;

    }


    saveWorkflowButton.disabled =
      true;

    saveWorkflowButton.textContent =
      "Saving...";


    try {

      const {
        error:
          deleteError
      } =
      await supabase
        .from(
          "production_stages"
        )
        .delete()
        .eq(
          "product_id",
          workflowProductId
        );


      if (deleteError) {
        throw deleteError;
      }


      const rows =
        cleanedStages.map(
          (
            stage,
            index
          ) => ({

            product_id:
              workflowProductId,

            name:
              stage.name,

            stage_order:
              index + 1

          })
        );


      const {
        error:
          insertError
      } =
      await supabase
        .from(
          "production_stages"
        )
        .insert(rows);


      if (insertError) {
        throw insertError;
      }


      workflowMessage.textContent =
        "Production workflow saved.";

      workflowMessage.classList.add(
        "success-message"
      );


      await loadWorkflowStages();


    } catch (error) {

      console.error(
        "Workflow save failed:",
        error
      );


      workflowMessage.textContent =
        error.message ||
        "Unable to save production workflow.";

      workflowMessage.classList.remove(
        "success-message"
      );


    } finally {

      saveWorkflowButton.disabled =
        false;

      saveWorkflowButton.textContent =
        "Save Workflow";

    }

  }
);


// ============================================================
// WORKFLOW NAVIGATION
// ============================================================

workflowBackButton.addEventListener(
  "click",
  () => {

    workflowProductId =
      null;

    workflowStages =
      [];

    navigate("products");

  }
);


cancelWorkflowButton.addEventListener(
  "click",
  () => {

    workflowProductId =
      null;

    workflowStages =
      [];

    navigate("products");

  }
);


// ============================================================
// QR MANAGEMENT
// ============================================================

async function loadQrManagement() {

  clearQrMessage();

  await loadQrProducts();

  await loadQrSeries();

}


async function loadQrProducts() {

  qrProduct.innerHTML = `
    <option value="">
      Select product
    </option>
  `;


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
      name
    `)
    .eq(
      "seller_id",
      session.user.id
    )
    .order(
      "name",
      {
        ascending:
          true
      }
    );


  if (error) {
    throw error;
  }


  data.forEach(
    (product) => {

      const option =
        document.createElement(
          "option"
        );

      option.value =
        product.id;

      option.textContent =
        product.name;


      qrProduct.appendChild(
        option
      );

    }
  );

}


async function loadQrSeries() {

  qrSeriesList.innerHTML =
    "";

  emptyQrState.hidden =
    true;


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
    .from("qr_series")
    .select(`
      id,
      series_name,
      quantity,
      created_at,
      products (
        name
      ),
      qr_codes (
        status
      )
    `)
    .eq(
      "seller_id",
      session.user.id
    )
    .order(
      "created_at",
      {
        ascending:
          false
      }
    );


  if (error) {
    throw error;
  }


  if (!data.length) {

    emptyQrState.hidden =
      false;

    return;

  }


  data.forEach(
    (series) => {

      qrSeriesList.appendChild(
        createQrSeriesCard(
          series
        )
      );

    }
  );

}


function createQrSeriesCard(
  series
) {

  const card =
    document.createElement(
      "article"
    );

  card.className =
    "qr-series-card";


  const title =
    document.createElement(
      "h3"
    );

  title.textContent =
    series.series_name;


  const product =
    document.createElement(
      "p"
    );

  product.textContent =
    `Product: ${
      series.products?.name ||
      "Unknown"
    }`;


  const total =
    document.createElement(
      "p"
    );

  total.textContent =
    `Total pairs: ${
      series.quantity
    }`;


  const counts = {

    available:
      0,

    assigned:
      0,

    released:
      0,

    revoked:
      0

  };


  for (
    const qr of
    series.qr_codes || []
  ) {

    if (
      counts[
        qr.status
      ] !== undefined
    ) {

      counts[
        qr.status
      ]++;

    }

  }


  const status =
    document.createElement(
      "p"
    );

  status.className =
    "qr-series-status";


  status.textContent =
    `Available: ${counts.available} · ` +
    `Assigned: ${counts.assigned} · ` +
    `Released: ${counts.released} · ` +
    `Revoked: ${counts.revoked}`;


  const printButton =
    document.createElement(
      "button"
    );

  printButton.type =
    "button";

  printButton.className =
    "secondary-button qr-print-button";

  printButton.textContent =
    `Print Available Cards (${
      counts.available
    })`;

  printButton.disabled =
    counts.available === 0;


  printButton.addEventListener(
    "click",
    () => {

      openQrPrintScreen(
        series
      );

    }
  );


  card.appendChild(
    title
  );

  card.appendChild(
    product
  );

  card.appendChild(
    total
  );

  card.appendChild(
    status
  );

  card.appendChild(
    printButton
  );


  return card;

}


// ============================================================
// CREATE QR SERIES
// ============================================================

qrSeriesForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    clearQrMessage();


    const productId =
      qrProduct.value;

    const seriesName =
      qrSeriesName.value.trim();

    const quantity =
      Number(
        qrQuantity.value
      );


    if (!productId) {

      qrMessage.textContent =
        "Select a product.";

      return;

    }


    if (!seriesName) {

      qrMessage.textContent =
        "Enter a series name.";

      return;

    }


    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 5000
    ) {

      qrMessage.textContent =
        "Enter a quantity between 1 and 5000.";

      return;

    }


    generateQrButton.disabled =
      true;

    generateQrButton.textContent =
      "Generating...";


    try {

      const {
        data,
        error
      } =
      await supabase.rpc(
        "create_qr_series",
        {

          requested_product_id:
            productId,

          requested_series_name:
            seriesName,

          requested_quantity:
            quantity

        }
      );


      if (error) {
        throw error;
      }


      console.log(
        "Created QR series:",
        data
      );


      qrSeriesForm.reset();


      qrMessage.textContent =
        "QR series generated successfully.";

      qrMessage.classList.add(
        "success-message"
      );


      await loadQrSeries();


    } catch (error) {

      console.error(
        "QR generation failed:",
        error
      );


      qrMessage.classList.remove(
        "success-message"
      );


      qrMessage.textContent =
        error.message ||
        "Unable to generate QR series.";


    } finally {

      generateQrButton.disabled =
        false;

      generateQrButton.textContent =
        "Generate QR Series";

    }

  }
);


// ============================================================
// QR NAVIGATION
// ============================================================

qrManagementButton.addEventListener(
  "click",
  () => {

    navigate("qr");

  }
);


qrManagementButtonFromProducts.addEventListener(
  "click",
  () => {

    navigate("qr");

  }
);


qrBackButton.addEventListener(
  "click",
  () => {

    navigate("products");

  }
);


// ============================================================
// QR PRINTING
// ============================================================

async function openQrPrintScreen(
  series
) {

  printSeriesId =
    series.id;


  printSeriesName.textContent =
    series.series_name;


  printCardGrid.innerHTML =
    "";


  navigate(
    "qr-print"
  );

}


async function loadPrintableQrCards() {

  printCardGrid.innerHTML =
    "";


  const session =
    await getSession();


  if (!session) {

    navigate("login");

    return;

  }


  const shopProfile =
    await loadSellerProfile(
      session.user.id
    );


  const {
    data: series,
    error: seriesError
  } =
  await supabase
    .from("qr_series")
    .select(`
      id,
      series_name,
      quantity,
      products (
        name
      )
    `)
    .eq(
      "id",
      printSeriesId
    )
    .eq(
      "seller_id",
      session.user.id
    )
    .single();


  if (seriesError) {
    throw seriesError;
  }


  const {
    data: qrCodes,
    error: qrError
  } =
  await supabase
    .from("qr_codes")
    .select(`
      id,
      code,
      public_token,
      status,
      created_at
    `)
    .eq(
      "series_id",
      printSeriesId
    )
    .eq(
      "seller_id",
      session.user.id
    )
    .eq(
      "status",
      "available"
    )
    .order(
      "created_at",
      {
        ascending:
          true
      }
    );


  if (qrError) {
    throw qrError;
  }


  const productName =
    series.products?.name ||
    "Product";


  printSeriesInfo.textContent =
    `${shopProfile.shop_name} · ` +
    `${productName} · ` +
    `${qrCodes.length} available pairs`;


  if (!qrCodes.length) {

    printCardGrid.innerHTML = `
      <div class="empty-state">
        <h3>No Available QR Cards</h3>
        <p>
          There are no available QR cards
          left in this series to print.
        </p>
      </div>
    `;

    return;

  }


  const trackingBase =
    `${window.location.origin}/t/`;


  for (
    const qr of qrCodes
  ) {

    const pair =
      document.createElement(
        "div"
      );

    pair.className =
      "qr-print-pair";


    const trackingUrl =
      `${trackingBase}${qr.public_token}`;


    const sellerCard =
      await createPrintableQrCard({

        copyType:
          "SELLER COPY",

        shopName:
          shopProfile.shop_name,

        productName,

        trackingUrl,

        qrCode:
          qr.code

      });


    const customerCard =
      await createPrintableQrCard({

        copyType:
          "CUSTOMER COPY",

        shopName:
          shopProfile.shop_name,

        productName,

        trackingUrl,

        qrCode:
          qr.code

      });


    pair.appendChild(
      sellerCard
    );

    pair.appendChild(
      customerCard
    );


    printCardGrid.appendChild(
      pair
    );

  }

}


async function createPrintableQrCard({
  copyType,
  shopName,
  productName,
  trackingUrl,
  qrCode
}) {

  const card =
    document.createElement(
      "article"
    );

  card.className =
    "print-card";


  const header =
    document.createElement(
      "div"
    );

  header.className =
    "print-card-header";


  const shop =
    document.createElement(
      "div"
    );

  shop.className =
    "print-card-shop";

  shop.textContent =
    shopName;


  const copy =
    document.createElement(
      "div"
    );

  copy.className =
    "print-card-copy";

  copy.textContent =
    copyType;


  header.appendChild(
    shop
  );

  header.appendChild(
    copy
  );


  const product =
    document.createElement(
      "div"
    );

  product.className =
    "print-card-product";

  product.textContent =
    productName;


  const qrContainer =
    document.createElement(
      "div"
    );

  qrContainer.className =
    "print-card-qr";


  const canvas =
    document.createElement(
      "canvas"
    );

  canvas.width =
    420;

  canvas.height =
    420;


  qrContainer.appendChild(
    canvas
  );


  const instruction =
    document.createElement(
      "div"
    );

  instruction.className =
    "print-card-instruction";

  instruction.textContent =
    "Scan to track your order";


  const url =
    document.createElement(
      "div"
    );

  url.className =
    "print-card-url";

  url.textContent =
    trackingUrl;


  const code =
    document.createElement(
      "div"
    );

  code.className =
    "print-card-code";

  code.textContent =
    qrCode;


  card.appendChild(
    header
  );

  card.appendChild(
    product
  );

  card.appendChild(
    qrContainer
  );

  card.appendChild(
    instruction
  );

  card.appendChild(
    url
  );


  if (
    copyType ===
    "SELLER COPY"
  ) {

    card.appendChild(
      code
    );

  }


  await renderQrCode(
    canvas,
    trackingUrl
  );


  fitProductName(
    product
  );


  return card;

}


function renderQrCode(
  canvas,
  value
) {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      try {

        if (
          typeof QRCode ===
          "undefined"
        ) {

          throw new Error(
            "QR code library is not loaded."
          );

        }


        const qr =
          QRCode.QRCodeBrowser(
            canvas
          );


        qr.setOptions({

          text:
            value,

          size:
            420,

          qr: {

            correctLevel:
              2

          }

        });


        qr.draw();


        resolve();

      } catch (error) {

        reject(
          error
        );

      }

    }
  );

}


function fitProductName(
  element
) {

  let fontSize =
    13;


  element.style.fontSize =
    `${fontSize}pt`;


  while (
    element.scrollWidth >
      element.clientWidth &&
    fontSize > 5
  ) {

    fontSize -=
      0.5;


    element.style.fontSize =
      `${fontSize}pt`;

  }

}


// ============================================================
// PRINT BUTTON
// ============================================================

printCardsButton.addEventListener(
  "click",
  () => {

    if (
      !printCardGrid.children.length
    ) {

      return;

    }


    window.print();

  }
);


// ============================================================
// CLOSE PRINT SCREEN
// ============================================================

closePrintButton.addEventListener(
  "click",
  () => {

    printSeriesId =
      null;

    printCardGrid.innerHTML =
      "";

    navigate(
      "qr"
    );

  }
);


// ============================================================
// ORDERS
// ============================================================

async function loadOrders() {

  const session =
    await getSession();


  if (!session) {

    navigate("login");

    return;

  }


  orderList.innerHTML =
    "";

  emptyOrdersState.hidden =
    true;

  orderEditor.hidden =
    true;

  orderList.hidden =
    false;


  const {
    data,
    error
  } =
  await supabase
    .from("orders")
    .select(`
      id,
      order_number,
      customer_name,
      customer_phone,
      total_amount,
      status,
      created_at,
      order_items (
        product_name,
        quantity
      )
    `)
    .eq(
      "seller_id",
      session.user.id
    )
    .order(
      "created_at",
      {
        ascending:
          false
      }
    );


  if (error) {
    throw error;
  }


  if (!data.length) {

    emptyOrdersState.hidden =
      false;

    return;

  }


  data.forEach(
    (order) => {

      orderList.appendChild(
        createOrderCard(
          order
        )
      );

    }
  );

}


function createOrderCard(
  order
) {

  const card =
    document.createElement(
      "article"
    );

  card.className =
    "order-card";


  const header =
    document.createElement(
      "div"
    );

  header.className =
    "order-card-header";


  const number =
    document.createElement(
      "strong"
    );

  number.textContent =
    `Order #${order.order_number}`;


  const customer =
    document.createElement(
      "span"
    );

  customer.textContent =
    order.customer_name;


  header.appendChild(
    number
  );

  header.appendChild(
    customer
  );


  const items =
    document.createElement(
      "div"
    );

  items.className =
    "order-card-items";


  for (
    const item of
    order.order_items || []
  ) {

    const row =
      document.createElement(
        "div"
      );

    row.textContent =
      `${item.product_name} × ${item.quantity}`;


    items.appendChild(
      row
    );

  }


  const total =
    document.createElement(
      "strong"
    );

  total.className =
    "order-card-total";

  total.textContent =
    formatPrice(
      order.total_amount
    );


  card.appendChild(
    header
  );

  card.appendChild(
    items
  );

  card.appendChild(
    total
  );


  return card;

}


// ============================================================
// OPEN ORDER EDITOR
// ============================================================

async function openOrderEditor() {

  clearOrderMessage();


  orderEditor.hidden =
    false;

  orderList.hidden =
    true;

  emptyOrdersState.hidden =
    true;


  orderCustomerName.value =
    "";

  orderCustomerPhone.value =
    "";

  orderBuilderItems =
    [];


  orderItems.innerHTML =
    "";

  emptyOrderItems.hidden =
    false;


  try {

    await loadOrderProducts();

    addOrderItem();

  } catch (error) {

    console.error(
      "Unable to open order editor:",
      error
    );


    orderMessage.textContent =
      error.message ||
      "Unable to load products.";

  }

}


async function loadOrderProducts() {

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
      default_price
    `)
    .eq(
      "seller_id",
      session.user.id
    )
    .order(
      "name",
      {
        ascending:
          true
      }
    );


  if (error) {
    throw error;
  }


  orderProducts =
    data;

}


// ============================================================
// ORDER ITEMS
// ============================================================

function addOrderItem() {

  if (
    !orderProducts.length
  ) {

    orderMessage.textContent =
      "Create a product before creating an order.";

    return;

  }


  const item = {

    id:
      crypto.randomUUID(),

    productId:
      "",

    quantity:
      1,

    unitPrice:
      0,

    qrCodeId:
      ""

  };


  orderBuilderItems.push(
    item
  );


  renderOrderItems();

}


async function renderOrderItems() {

  orderItems.innerHTML =
    "";


  emptyOrderItems.hidden =
    orderBuilderItems.length > 0;


  for (
    let index = 0;
    index <
      orderBuilderItems.length;
    index++
  ) {

    const item =
      orderBuilderItems[index];


    const element =
      createOrderItemElement(
        item,
        index
      );


    orderItems.appendChild(
      element
    );


    if (
      item.productId
    ) {

      const qrSelect =
        element.querySelector(
          ".order-item-qr"
        );


      if (qrSelect) {

        await loadAvailableQrOptions(
          qrSelect,
          item
        );

      }

    }

  }


  updateOrderTotal();

}


function createOrderItemElement(
  item,
  index
) {

  const wrapper =
    document.createElement(
      "div"
    );

  wrapper.className =
    "order-item";


  // ------------------------------------------
  // Product
  // ------------------------------------------

  const productGroup =
    document.createElement(
      "div"
    );

  productGroup.className =
    "form-group";


  const productLabel =
    document.createElement(
      "label"
    );

  productLabel.textContent =
    "Product";


  const productSelect =
    document.createElement(
      "select"
    );

  productSelect.className =
    "order-item-product";


  const defaultOption =
    document.createElement(
      "option"
    );

  defaultOption.value =
    "";

  defaultOption.textContent =
    "Select product";


  productSelect.appendChild(
    defaultOption
  );


  orderProducts.forEach(
    (product) => {

      const option =
        document.createElement(
          "option"
        );

      option.value =
        product.id;

      option.textContent =
        product.name;


      option.selected =
        product.id ===
        item.productId;


      productSelect.appendChild(
        option
      );

    }
  );


  productSelect.addEventListener(
    "change",
    async () => {

      item.productId =
        productSelect.value;


      const product =
        orderProducts.find(
          (entry) =>
            entry.id ===
            item.productId
        );


      item.unitPrice =
        product
          ? Number(
              product.default_price
            )
          : 0;


      item.qrCodeId =
        "";


      await renderOrderItems();

    }
  );


  productGroup.appendChild(
    productLabel
  );

  productGroup.appendChild(
    productSelect
  );


  // ------------------------------------------
  // Quantity
  // ------------------------------------------

  const quantityGroup =
    document.createElement(
      "div"
    );

  quantityGroup.className =
    "form-group";


  const quantityLabel =
    document.createElement(
      "label"
    );

  quantityLabel.textContent =
    "Quantity";


  const quantityInput =
    document.createElement(
      "input"
    );

  quantityInput.type =
    "number";

  quantityInput.min =
    "1";

  quantityInput.step =
    "1";

  quantityInput.inputMode =
    "numeric";

  quantityInput.value =
    item.quantity;


  quantityInput.addEventListener(
    "input",
    () => {

      const value =
        Number(
          quantityInput.value
        );


      item.quantity =
        Number.isInteger(
          value
        ) &&
        value > 0
          ? value
          : 1;


      updateOrderTotal();

    }
  );


  quantityGroup.appendChild(
    quantityLabel
  );

  quantityGroup.appendChild(
    quantityInput
  );


  // ------------------------------------------
  // Unit Price
  // ------------------------------------------

  const priceGroup =
    document.createElement(
      "div"
    );

  priceGroup.className =
    "form-group";


  const priceLabel =
    document.createElement(
      "label"
    );

  priceLabel.textContent =
    "Unit Price";


  const priceInputWrapper =
    document.createElement(
      "div"
    );

  priceInputWrapper.className =
    "price-input";


  const peso =
    document.createElement(
      "span"
    );

  peso.textContent =
    "₱";


  const priceInput =
    document.createElement(
      "input"
    );

  priceInput.type =
    "number";

  priceInput.min =
    "0";

  priceInput.step =
    "0.01";

  priceInput.inputMode =
    "decimal";

  priceInput.value =
    item.unitPrice;


  priceInput.addEventListener(
    "input",
    () => {

      const value =
        Number(
          priceInput.value
        );


      item.unitPrice =
        Number.isFinite(
          value
        ) &&
        value >= 0
          ? value
          : 0;


      updateOrderTotal();

    }
  );


  priceInputWrapper.appendChild(
    peso
  );

  priceInputWrapper.appendChild(
    priceInput
  );


  priceGroup.appendChild(
    priceLabel
  );

  priceGroup.appendChild(
    priceInputWrapper
  );


  // ------------------------------------------
  // QR
  // ------------------------------------------

  const qrGroup =
    document.createElement(
      "div"
    );

  qrGroup.className =
    "form-group";


  const qrLabel =
    document.createElement(
      "label"
    );

  qrLabel.textContent =
    "QR";


  const qrSelect =
    document.createElement(
      "select"
    );

  qrSelect.className =
    "order-item-qr";

  qrSelect.disabled =
    !item.productId;


  const qrPlaceholder =
    document.createElement(
      "option"
    );

  qrPlaceholder.value =
    "";

  qrPlaceholder.textContent =
    item.productId
      ? "Loading available QR..."
      : "Select product first";


  qrSelect.appendChild(
    qrPlaceholder
  );


  qrSelect.addEventListener(
    "change",
    () => {

      item.qrCodeId =
        qrSelect.value;

    }
  );


  qrGroup.appendChild(
    qrLabel
  );

  qrGroup.appendChild(
    qrSelect
  );


  // ------------------------------------------
  // Remove
  // ------------------------------------------

  const removeButton =
    document.createElement(
      "button"
    );

  removeButton.type =
    "button";

  removeButton.className =
    "danger-button order-remove-button";

  removeButton.textContent =
    "Remove";


  removeButton.addEventListener(
    "click",
    async () => {

      orderBuilderItems =
        orderBuilderItems.filter(
          (entry) =>
            entry.id !==
            item.id
        );


      await renderOrderItems();

    }
  );


  // ------------------------------------------
  // Item total
  // ------------------------------------------

  const itemTotal =
    document.createElement(
      "div"
    );

  itemTotal.className =
    "order-item-total";


  itemTotal.textContent =
    `Item Total: ${
      formatPrice(
        item.quantity *
        item.unitPrice
      )
    }`;


  // Update item total when values change.
  quantityInput.addEventListener(
    "input",
    () => {

      itemTotal.textContent =
        `Item Total: ${
          formatPrice(
            item.quantity *
            item.unitPrice
          )
        }`;

    }
  );


  priceInput.addEventListener(
    "input",
    () => {

      itemTotal.textContent =
        `Item Total: ${
          formatPrice(
            item.quantity *
            item.unitPrice
          )
        }`;

    }
  );


  // ------------------------------------------
  // Assemble
  // ------------------------------------------

  wrapper.appendChild(
    productGroup
  );

  wrapper.appendChild(
    quantityGroup
  );

  wrapper.appendChild(
    priceGroup
  );

  wrapper.appendChild(
    qrGroup
  );

  wrapper.appendChild(
    itemTotal
  );

  wrapper.appendChild(
    removeButton
  );


  return wrapper;

}


async function loadAvailableQrOptions(
  select,
  item
) {

  const session =
    await getSession();


  if (!session) {
    return;
  }


  const {
    data,
    error
  } =
  await supabase
    .from(
      "qr_codes"
    )
    .select(`
      id,
      code,
      created_at
    `)
    .eq(
      "product_id",
      item.productId
    )
    .eq(
      "seller_id",
      session.user.id
    )
    .eq(
      "status",
      "available"
    )
    .order(
      "created_at",
      {
        ascending:
          true
      }
    );


  if (error) {

    console.error(
      "Unable to load QR inventory:",
      error
    );

    select.innerHTML = `
      <option value="">
        Unable to load QR
      </option>
    `;

    return;

  }


  select.innerHTML =
    "";


  const placeholder =
    document.createElement(
      "option"
    );

  placeholder.value =
    "";

  placeholder.textContent =
    data.length
      ? "Select QR"
      : "No available QR";


  select.appendChild(
    placeholder
  );


  data.forEach(
    (qr) => {

      const option =
        document.createElement(
          "option"
        );

      option.value =
        qr.id;

      option.textContent =
        qr.code;


      if (
        qr.id ===
        item.qrCodeId
      ) {

        option.selected =
          true;

      }


      select.appendChild(
        option
      );

    }
  );


  select.disabled =
    data.length === 0;

}


function updateOrderTotal() {

  let total =
    0;


  orderBuilderItems.forEach(
    (item) => {

      total +=
        item.quantity *
        item.unitPrice;

    }
  );


  orderTotal.textContent =
    formatPrice(
      total
    );

}


function clearOrderMessage() {

  orderMessage.textContent =
    "";

}


// ============================================================
// SAVE ORDER
// ============================================================

async function saveOrder() {

  clearOrderMessage();


  const customerName =
    orderCustomerName.value.trim();

  const customerPhone =
    orderCustomerPhone.value.trim();


  if (!customerName) {

    orderMessage.textContent =
      "Customer name is required.";

    return;

  }


  if (
    !orderBuilderItems.length
  ) {

    orderMessage.textContent =
      "Add at least one product.";

    return;

  }


  for (
    const item of
    orderBuilderItems
  ) {

    if (!item.productId) {

      orderMessage.textContent =
        "Every order item needs a product.";

      return;

    }


    if (
      !Number.isInteger(
        item.quantity
      ) ||
      item.quantity <= 0
    ) {

      orderMessage.textContent =
        "Quantity must be greater than zero.";

      return;

    }


    if (
      !Number.isFinite(
        item.unitPrice
      ) ||
      item.unitPrice < 0
    ) {

      orderMessage.textContent =
        "Unit price must not be negative.";

      return;

    }


    if (!item.qrCodeId) {

      orderMessage.textContent =
        "Every product needs one assigned QR.";

      return;

    }

  }


  saveOrderButton.disabled =
    true;

  saveOrderButton.textContent =
    "Creating...";


  try {

    const {
      data,
      error
    } =
    await supabase.rpc(
      "create_order",
      {

        requested_customer_name:
          customerName,

        requested_customer_phone:
          customerPhone,

        requested_items:
          orderBuilderItems.map(
            (item) => ({

              product_id:
                item.productId,

              quantity:
                item.quantity,

              unit_price:
                item.unitPrice,

              qr_code_id:
                item.qrCodeId

            })
          )

      }
    );


    if (error) {
      throw error;
    }


    orderBuilderItems =
      [];

    orderEditor.hidden =
      true;

    orderList.hidden =
      false;


    await loadOrders();


  } catch (error) {

    console.error(
      "Order creation failed:",
      error
    );


    orderMessage.textContent =
      error.message ||
      "Unable to create order.";


  } finally {

    saveOrderButton.disabled =
      false;

    saveOrderButton.textContent =
      "Create Order";

  }

}


// ============================================================
// ORDER EVENTS
// ============================================================

orderForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    await saveOrder();

  }
);


ordersButton.addEventListener(
  "click",
  () => {

    navigate("orders");

  }
);


ordersBackButton.addEventListener(
  "click",
  () => {

    navigate("home");

  }
);


createOrderButton.addEventListener(
  "click",
  async () => {

    await openOrderEditor();

  }
);


emptyCreateOrderButton.addEventListener(
  "click",
  async () => {

    await openOrderEditor();

  }
);


addOrderItemButton.addEventListener(
  "click",
  async () => {

    addOrderItem();

  }
);


cancelOrderButton.addEventListener(
  "click",
  () => {

    orderBuilderItems =
      [];

    orderEditor.hidden =
      true;

    orderList.hidden =
      false;

  }
);


// ============================================================
// LOGOUT
// ============================================================

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


    workflowProductId =
      null;

    workflowStages =
      [];

    printSeriesId =
      null;

    orderBuilderItems =
      [];


    navigate(
      "login"
    );


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


ordersLogoutButton.addEventListener(
  "click",
  logout
);


// ============================================================
// PROFILE NAVIGATION
// ============================================================

editShopProfileButton.addEventListener(
  "click",
  () => {

    navigate(
      "shop-profile"
    );

  }
);


// ============================================================
// AUTH STATE
// ============================================================

supabase.auth.onAuthStateChange(
  async (_event, session) => {

    try {

      if (!session) {

        showScreen(
          "login"
        );

        return;

      }


      await renderApplication();


    } catch (error) {

      console.error(
        "Auth state error:",
        error
      );

      /*
       * Do not log the seller out because
       * a database or rendering operation failed.
       */

    }

  }
);


// ============================================================
// ROUTING
// ============================================================

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

    }

  }
);


// ============================================================
// MESSAGE HELPERS
// ============================================================

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


function clearWorkflowMessage() {

  workflowMessage.textContent =
    "";

  workflowMessage.classList.remove(
    "success-message"
  );

}


function clearQrMessage() {

  qrMessage.textContent =
    "";

  qrMessage.classList.remove(
    "success-message"
  );

}


// ============================================================
// FORMAT PRICE
// ============================================================

function formatPrice(
  value
) {

  const number =
    Number(value);


  return new Intl.NumberFormat(
    "en-PH",
    {

      style:
        "currency",

      currency:
        "PHP"

    }
  ).format(

    Number.isFinite(
      number
    )
      ? number
      : 0

  );

}


// ============================================================
// FILE EXTENSION
// ============================================================

function getFileExtension(
  fileName
) {

  const parts =
    fileName.split(".");


  if (
    parts.length < 2
  ) {

    return "jpg";

  }


  return parts
    .pop()
    .toLowerCase();

}


// ============================================================
// INITIALIZE
// ============================================================

async function initializeApp() {

  try {

    await renderApplication();


  } catch (error) {

    console.error(
      "Application initialization failed:",
      error
    );

  }

}


initializeApp();