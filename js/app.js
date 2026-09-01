import { supabase } from "./supabase.js";


// ============================================================
// HELPERS
// ============================================================

const $ = (id) =>
  document.getElementById(id);


// ============================================================
// SCREENS
// ============================================================

const screens = {

  login:
    $("loginScreen"),

  register:
    $("registerScreen"),

  shopSetup:
    $("shopSetupScreen"),

  home:
    $("homeScreen"),

  products:
    $("productsScreen"),

  workflow:
    $("workflowScreen"),

  qr:
    $("qrScreen"),

  scanner:
    $("scannerScreen"),

  orderCreate:
    $("orderCreateScreen"),

  orderDetail:
    $("orderDetailScreen"),

  tracking:
    $("trackingScreen")

};


// ============================================================
// STATE
// ============================================================

let editingProductId =
  null;

let renderInFlight =
  null;

let workflowProductId =
  null;

let workflowProductName =
  "";

let workflowStages =
  [];

let qrProducts = [];

let pendingQrToken = null;
let pendingProduct = null;
let currentOrderId = null;

let currentOrderTotal = 0;
let currentOrderPaid = 0;
let scannerInstance = null;
let qrScanBusy = false;


// ============================================================
// ROUTING
// ============================================================

const validRoutes = [
  "login",
  "register",
  "shop-setup",
  "home",
  "products",
  "workflow",
  "qr",
  "scanner",
  "order-create",
  "order-detail"
];


function getRoute() {

  const route =
    window.location.hash
      .replace(/^#/, "")
      .toLowerCase();


  return validRoutes.includes(route)
    ? route
    : "login";

}


function navigate(route) {

  if (
    window.location.hash ===
    `#${route}`
  ) {

    return;

  }


  window.location.hash =
    route;

}


function showScreen(route) {

  Object.entries(
    screens
  ).forEach(
    (
      [name, element]
    ) => {

      if (element) {

        element.hidden =
          name !==
          route;

      }

    }
  );

}


function getTrackingToken() {

  const pathname =
    window.location.pathname
      .replace(/\/+$/, "");

  const match =
    pathname.match(/^\/t\/([^/]+)$/i);

  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch (error) {
    return null;
  }

}


// ============================================================
// AUTH
// ============================================================

async function getSession() {

  const {
    data,
    error
  } =
    await supabase
      .auth
      .getSession();


  if (error) {

    throw error;

  }


  return data.session;

}


async function getCurrentUser() {

  const {
    data,
    error
  } =
  await supabase
    .auth
    .getUser();


  if (error) {

    throw error;

  }


  if (!data.user) {

    throw new Error(
      "No authenticated user."
    );

  }


  return data.user;

}


// ============================================================
// SELLER
// ============================================================

async function getSeller(
  userId
) {

  const {
    data,
    error
  } =
  await supabase
    .from("sellers")
    .select(`
      id,
      email,
      login_method,
      google_id,
      shop_name,
      shop_address,
      shop_logo_path
    `)
    .eq(
      "id",
      userId
    )
    .maybeSingle();


  if (error) {

    throw error;

  }


  return data;

}


function shopComplete(
  seller
) {

  return Boolean(
    seller?.shop_name?.trim() &&
    seller?.shop_address?.trim()
  );

}


// ============================================================
// APPLICATION
// ============================================================

async function renderApplication() {

  if (renderInFlight) {
    return renderInFlight;
  }

  renderInFlight =
    (async () => {


  try {

    const trackingToken =
      getTrackingToken();


    if (trackingToken) {

      await renderTrackingPage(
        trackingToken
      );

      return;

    }


    const session =
      await getSession();


    if (!session) {

      showScreen(
        getRoute() ===
          "register"
          ? "register"
          : "login"
      );

      return;

    }


    const seller =
      await getSeller(
        session.user.id
      );


    if (!seller) {

      throw new Error(
        "Seller profile was not found. Run the Seller/Shop database setup first."
      );

    }


    if (
      !shopComplete(
        seller
      )
    ) {

      populateShopForm(
        seller
      );

      showScreen(
        "shopSetup"
      );

      return;

    }


    if (
      getRoute() ===
      "scanner"
    ) {

      showScreen(
        "scanner"
      );

      await startQrScanner();

      return;

    }


    if (
      getRoute() ===
      "order-create"
    ) {

      showScreen(
        "orderCreate"
      );

      updateOrderCreateTotals();

      return;

    }


    if (
      getRoute() ===
      "order-detail"
    ) {

      showScreen(
        "orderDetail"
      );

      if (
        currentOrderId
      ) {

        await loadOrderDetail(
          currentOrderId
        );

      }

      return;

    }


    if (
      getRoute() ===
      "products"
    ) {

      showScreen(
        "products"
      );

      await loadProducts();

      return;

    }


    if (
      getRoute() ===
      "workflow"
    ) {

      if (
        !workflowProductId
      ) {

        navigate(
          "products"
        );

        return;

      }


      showScreen(
        "workflow"
      );

      await loadWorkflow();

      return;

    }


    if (
      getRoute() ===
      "qr"
    ) {

      showScreen(
        "qr"
      );

      await loadQrManagement();

      return;

    }


    if (
      getRoute() ===
      "shop-setup"
    ) {

      populateShopForm(
        seller
      );

      showScreen(
        "shopSetup"
      );

      return;

    }


    await renderHome(
      seller
    );


  } catch (error) {

    console.error(
      "Application render error:",
      error
    );


    showScreen(
      "login"
    );


    $("loginMessage").textContent =
      error?.message ||
      "Unable to load the application.";

  }


    })();

  try {

    return await renderInFlight;

  } finally {

    renderInFlight =
      null;

  }

}


// ============================================================
// HOME
// ============================================================

async function renderHome(
  seller
) {

  $("homeShopName")
    .textContent =
      seller.shop_name;


  $("homeShopAddress")
    .textContent =
      seller.shop_address ||
      "";


  await loadHomeLogo(
    seller.shop_logo_path
  );


  showScreen(
    "home"
  );

}


async function loadHomeLogo(
  logoPath
) {

  $("homeLogoContainer")
    .hidden =
      true;


  $("homeLogo")
    .removeAttribute(
      "src"
    );


  if (!logoPath) {

    return;

  }


  const {
    data,
    error
  } =
  await supabase
    .storage
    .from(
      "shop-logos"
    )
    .createSignedUrl(
      logoPath,
      3600
    );


  if (error) {

    console.warn(
      "Unable to load shop logo:",
      error
    );

    return;

  }


  if (
    data?.signedUrl
  ) {

    $("homeLogo")
      .src =
        data.signedUrl;


    $("homeLogoContainer")
      .hidden =
        false;

  }

}


// ============================================================
// AUTH FORMS
// ============================================================

$("loginForm")
  .addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();

      clearMessages();


      const email =
        $("loginEmail")
          .value
          .trim()
          .toLowerCase();


      const password =
        $("loginPassword")
          .value;


      setLoading(
        $("loginButton"),
        "Logging in..."
      );


      try {

        const {
          error
        } =
        await supabase
          .auth
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


        $("loginMessage")
          .textContent =
            getAuthError(
              error
            );


      } finally {

        resetButton(
          $("loginButton"),
          "Log In"
        );

      }

    }
  );


$("registerForm")
  .addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();

      clearMessages();


      const email =
        $("registerEmail")
          .value
          .trim()
          .toLowerCase();


      const password =
        $("registerPassword")
          .value;


      const confirm =
        $("registerConfirmPassword")
          .value;


      if (
        password.length <
        8
      ) {

        $("registerMessage")
          .textContent =
            "Password must be at least 8 characters.";

        return;

      }


      if (
        password !==
        confirm
      ) {

        $("registerMessage")
          .textContent =
            "Passwords do not match.";

        return;

      }


      setLoading(
        $("registerButton"),
        "Creating..."
      );


      try {

        const {
          data,
          error
        } =
        await supabase
          .auth
          .signUp({

            email,

            password

          });


        if (error) {

          throw error;

        }


        if (
          data.session
        ) {

          navigate(
            "shop-setup"
          );

        } else {

          $("registerMessage")
            .textContent =
              "Account created. Please confirm your email, then log in.";

        }


      } catch (error) {

        console.error(
          "Registration failed:",
          error
        );


        $("registerMessage")
          .textContent =
            getAuthError(
              error
            );


      } finally {

        resetButton(
          $("registerButton"),
          "Create Account"
        );

      }

    }
  );


// ============================================================
// GOOGLE
// ============================================================

async function googleAuth() {

  clearMessages();


  $("googleLoginButton")
    .disabled =
      true;


  $("googleRegisterButton")
    .disabled =
      true;


  try {

    const redirectTo =
      `${window.location.origin}${window.location.pathname}`;


    const {
      error
    } =
    await supabase
      .auth
      .signInWithOAuth({

        provider:
          "google",

        options: {

          redirectTo

        }

      });


    if (error) {

      throw error;

    }


  } catch (error) {

    const message =
      error?.message ||
      "Unable to continue with Google.";


    if (
      getRoute() ===
      "register"
    ) {

      $("registerMessage")
        .textContent =
          message;

    } else {

      $("loginMessage")
        .textContent =
          message;

    }


    $("googleLoginButton")
      .disabled =
        false;


    $("googleRegisterButton")
      .disabled =
        false;

  }

}


$("googleLoginButton")
  .addEventListener(
    "click",
    googleAuth
  );


$("googleRegisterButton")
  .addEventListener(
    "click",
    googleAuth
  );


// ============================================================
// SHOP
// ============================================================

$("shopSetupForm")
  .addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();

      clearMessages();


      let user;


      try {

        user =
          await getCurrentUser();

      } catch (error) {

        $("shopSetupMessage")
          .textContent =
            error?.message ||
            "Your session is no longer available.";

        return;

      }


      const name =
        $("shopName")
          .value
          .trim();


      const address =
        $("shopAddress")
          .value
          .trim();


      const logoFile =
        $("shopLogo")
          .files[0];


      if (
        name.length <
        2
      ) {

        $("shopSetupMessage")
          .textContent =
            "Shop name must be at least 2 characters.";

        return;

      }


      if (!address) {

        $("shopSetupMessage")
          .textContent =
            "Shop address is required.";

        return;

      }


      setLoading(
        $("saveShopButton"),
        "Saving..."
      );


      try {

        const seller =
          await getSeller(
            user.id
          );


        if (!seller) {

          throw new Error(
            "Seller profile was not found."
          );

        }


        let logoPath =
          seller.shop_logo_path;


        if (
          logoFile
        ) {

          validateLogo(
            logoFile
          );


          const extension =
            safeExtension(
              logoFile.name
            );


          const path =
            `${user.id}/${crypto.randomUUID()}.${extension}`;


          const {
            error:
              uploadError
          } =
          await supabase
            .storage
            .from(
              "shop-logos"
            )
            .upload(
              path,
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


          if (
            uploadError
          ) {

            throw uploadError;

          }


          const oldLogo =
            logoPath;


          logoPath =
            path;


          if (
            oldLogo
          ) {

            const {
              error:
                removeError
            } =
            await supabase
              .storage
              .from(
                "shop-logos"
              )
              .remove([
                oldLogo
              ]);


            if (
              removeError
            ) {

              console.warn(
                "Old logo could not be removed:",
                removeError
              );

            }

          }

        }


        const {
          data,
          error
        } =
        await supabase
          .from(
            "sellers"
          )
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
            user.id
          )
          .select()
          .single();


        if (error) {

          throw error;

        }


        if (!data) {

          throw new Error(
            "Shop profile was not updated."
          );

        }


        await renderApplication();


      } catch (error) {

        console.error(
          "Shop setup failed:",
          error
        );


        $("shopSetupMessage")
          .textContent =
            error?.message ||
            "Unable to save shop information.";

      } finally {

        resetButton(
          $("saveShopButton"),
          "Save Shop"
        );

      }

    }
  );


$("shopLogo")
  .addEventListener(
    "change",
    () => {

      const file =
        $("shopLogo")
          .files[0];


      if (!file) {

        $("shopLogoPreviewContainer")
          .hidden =
            true;


        $("shopLogoPreview")
          .removeAttribute(
            "src"
          );


        return;

      }


      try {

        validateLogo(
          file
        );


        $("shopLogoPreview")
          .src =
            URL.createObjectURL(
              file
            );


        $("shopLogoPreviewContainer")
          .hidden =
            false;


      } catch (error) {

        $("shopLogo")
          .value =
            "";


        $("shopLogoPreviewContainer")
          .hidden =
            true;


        $("shopSetupMessage")
          .textContent =
            error.message;

      }

    }
  );


$("editShopButton")
  .addEventListener(
    "click",
    async () => {

      try {

        const user =
          await getCurrentUser();


        const seller =
          await getSeller(
            user.id
          );


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
// PRODUCTS
// ============================================================

async function loadProducts() {

  const list = $("productList");

  // Always replace the rendered list. This function never appends onto
  // a previous database result.
  list.replaceChildren();
  $("emptyProductsState").hidden = true;
  $("productEditor").hidden = true;

  const user = await getCurrentUser();

  const { data, error } = await supabase
    .from("products")
    .select(`
      id,
      seller_id,
      name,
      default_price,
      customer_cancellable_until_stage,
      is_active,
      created_at,
      updated_at
    `)
    .eq("seller_id", user.id)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw error;

  // Ignore a response if the user navigated away while the request was running.
  if (getRoute() !== "products") return;

  list.replaceChildren();

  if (!data.length) {
    $("emptyProductsState").hidden = false;
    return;
  }

  const fragment = document.createDocumentFragment();

  data.forEach((product) => {
    fragment.appendChild(createProductCard(product));
  });

  list.appendChild(fragment);
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


  info.append(
    title,
    price
  );


  const actions =
    document.createElement(
      "div"
    );


  actions.className =
    "product-card-actions";


  const workflow =
    document.createElement(
      "button"
    );


  workflow.type =
    "button";


  workflow.textContent =
    "Workflow";


  workflow.addEventListener(
    "click",
    () => {

      openWorkflow(
        product
      );

    }
  );


  const edit =
    document.createElement(
      "button"
    );


  edit.type =
    "button";


  edit.className =
    "secondary-button";


  edit.textContent =
    "Edit";


  edit.addEventListener(
    "click",
    () => {

      openProductEditor(
        product
      );

    }
  );


  actions.append(
    workflow,
    edit
  );


  card.append(
    info,
    actions
  );


  return card;

}


function openProductEditor(
  product = null
) {

  $("productMessage")
    .textContent =
      "";


  if (product) {

    editingProductId =
      product.id;


    $("productEditorTitle")
      .textContent =
        "Edit Product";


    $("productName")
      .value =
        product.name;


    $("productPrice")
      .value =
        Number(
          product.default_price
        ).toFixed(2);

  } else {

    editingProductId =
      null;


    $("productEditorTitle")
      .textContent =
        "Add Product";


    $("productName")
      .value =
        "";


    $("productPrice")
      .value =
        "";

  }


  $("productEditor")
    .hidden =
      false;


  $("productName")
    .focus();

}


function closeProductEditor() {

  editingProductId =
    null;


  $("productEditor")
    .hidden =
      true;


  $("productName")
    .value =
      "";


  $("productPrice")
    .value =
      "";


  $("productMessage")
    .textContent =
      "";

}


$("productForm")
  .addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();

      await saveProduct();

    }
  );


async function saveProduct() {

  $("productMessage")
    .textContent =
      "";


  const user =
    await getCurrentUser();


  const name =
    $("productName")
      .value
      .trim();


  const price =
    Number(
      $("productPrice")
        .value
    );


  if (!name) {

    $("productMessage")
      .textContent =
        "Product name is required.";


    return;

  }


  if (
    name.length >
    150
  ) {

    $("productMessage")
      .textContent =
        "Product name must be 150 characters or fewer.";


    return;

  }


  if (
    !Number.isFinite(
      price
    ) ||
    price < 0
  ) {

    $("productMessage")
      .textContent =
        "Enter a valid non-negative price.";


    return;

  }


  setLoading(
    $("saveProductButton"),
    "Saving..."
  );


  try {

    if (
      editingProductId
    ) {

      const {
        data,
        error
      } =
      await supabase
        .from(
          "products"
        )
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
          user.id
        )
        .select()
        .single();


      if (error) {

        throw error;

      }


      if (!data) {

        throw new Error(
          "Product was not updated."
        );

      }

    } else {

      const {
        data,
        error
      } =
      await supabase
        .from(
          "products"
        )
        .insert({

          seller_id:
            user.id,

          name,

          default_price:
            price

        })
        .select()
        .single();


      if (error) {

        throw error;

      }


      if (!data) {

        throw new Error(
          "Product was not created."
        );

      }

    }


    closeProductEditor();


    await loadProducts();


  } catch (error) {

    console.error(
      "Product save failed:",
      error
    );


    $("productMessage")
      .textContent =
        error?.message ||
        "Unable to save product.";


  } finally {

    resetButton(
      $("saveProductButton"),
      "Save Product"
    );

  }

}


$("productsButton")
  .addEventListener(
    "click",
    () => {

      navigate(
        "products"
      );

    }
  );


$("productsBackButton")
  .addEventListener(
    "click",
    () => {

      closeProductEditor();

      navigate(
        "home"
      );

    }
  );


$("addProductButton")
  .addEventListener(
    "click",
    () => {

      openProductEditor();

    }
  );


$("emptyAddProductButton")
  .addEventListener(
    "click",
    () => {

      openProductEditor();

    }
  );


$("cancelProductButton")
  .addEventListener(
    "click",
    () => {

      closeProductEditor();

    }
  );


$("productsLogoutButton")
  .addEventListener(
    "click",
    logout
  );


// ============================================================
// WORKFLOW
// ============================================================

async function openWorkflow(
  product
) {

  workflowProductId =
    product.id;


  workflowProductName =
    product.name;


  $("workflowProductName")
    .textContent =
      product.name;


  clearWorkflowMessage();


  try {

    await loadWorkflow();


    navigate(
      "workflow"
    );


  } catch (error) {

    console.error(
      "Unable to open workflow:",
      error
    );


    $("workflowMessage")
      .textContent =
        error?.message ||
        "Unable to load this product's workflow.";

  }

}


async function loadWorkflow() {

  $("stageList")
    .innerHTML =
      "";


  $("emptyStagesState")
    .hidden =
      true;


  const user =
    await getCurrentUser();


  const {
    data:
      product,
    error:
      productError
  } =
  await supabase
    .from(
      "products"
    )
    .select(
      "id,name"
    )
    .eq(
      "id",
      workflowProductId
    )
    .eq(
      "seller_id",
      user.id
    )
    .single();


  if (
    productError
  ) {

    throw productError;

  }


  workflowProductName =
    product.name;


  $("workflowProductName")
    .textContent =
      product.name;


  const {
    data:
      stages,
    error:
      stagesError
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


  if (
    stagesError
  ) {

    throw stagesError;

  }


  workflowStages =
    stages.map(
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

  $("stageList")
    .innerHTML =
      "";


  if (
    !workflowStages.length
  ) {

    $("emptyStagesState")
      .hidden =
        false;


    return;

  }


  $("emptyStagesState")
    .hidden =
      true;


  workflowStages.forEach(
    (
      stage,
      index
    ) => {

      stage.stage_order =
        index + 1;


      $("stageList")
        .appendChild(
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


  input.maxLength =
    120;


  input.value =
    stage.name;


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


  const up =
    document.createElement(
      "button"
    );


  up.type =
    "button";


  up.className =
    "secondary-button stage-action-button";


  up.textContent =
    "↑";


  up.title =
    "Move up";


  up.disabled =
    index === 0;


  up.addEventListener(
    "click",
    () => {

      moveStage(
        index,
        -1
      );

    }
  );


  const down =
    document.createElement(
      "button"
    );


  down.type =
    "button";


  down.className =
    "secondary-button stage-action-button";


  down.textContent =
    "↓";


  down.title =
    "Move down";


  down.disabled =
    index ===
      workflowStages.length -
      1;


  down.addEventListener(
    "click",
    () => {

      moveStage(
        index,
        1
      );

    }
  );


  const remove =
    document.createElement(
      "button"
    );


  remove.type =
    "button";


  remove.className =
    "danger-button stage-action-button";


  remove.textContent =
    "Remove";


  remove.addEventListener(
    "click",
    () => {

      removeStage(
        index
      );

    }
  );


  actions.append(
    up,
    down,
    remove
  );


  item.append(
    number,
    input,
    actions
  );


  return item;

}


function moveStage(
  index,
  direction
) {

  const target =
    index +
    direction;


  if (
    target < 0 ||
    target >=
      workflowStages.length
  ) {

    return;

  }


  const current =
    workflowStages[index];


  workflowStages[index] =
    workflowStages[target];


  workflowStages[target] =
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
      workflowStages.length +
      1

  });


  renderWorkflowStages();


  const inputs =
    document.querySelectorAll(
      ".stage-name-input"
    );


  inputs[
    inputs.length -
      1
  ]?.focus();

}


$("addStageButton")
  .addEventListener(
    "click",
    addStage
  );


$("emptyAddStageButton")
  .addEventListener(
    "click",
    addStage
  );


// ============================================================
// SAVE WORKFLOW
// ============================================================

$("saveWorkflowButton")
  .addEventListener(
    "click",
    saveWorkflow
  );


async function saveWorkflow() {

  clearWorkflowMessage();


  const user =
    await getCurrentUser();


  if (
    !workflowProductId
  ) {

    $("workflowMessage")
      .textContent =
        "No product selected.";

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

    $("workflowMessage")
      .textContent =
        "Add at least one production stage.";

    return;

  }


  if (
    cleanedStages.some(
      (stage) =>
        !stage.name
    )
  ) {

    $("workflowMessage")
      .textContent =
        "Every stage needs a name.";

    return;

  }


  setLoading(
    $("saveWorkflowButton"),
    "Saving..."
  );


  try {

    /*
     * Verify the selected product belongs
     * to the authenticated seller.
     */

    const {
      data:
        product,
      error:
        productError
    } =
    await supabase
      .from(
        "products"
      )
      .select(
        "id"
      )
      .eq(
        "id",
        workflowProductId
      )
      .eq(
        "seller_id",
        user.id
      )
      .single();


    if (
      productError
    ) {

      throw productError;

    }


    /*
     * Replacing the workflow is done as a
     * single logical operation:
     *
     * delete existing stages
     * insert the new ordered list
     *
     * This is safe here because the actual
     * historical workflow snapshot is created
     * later when an order item is created.
     */

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
        product.id
      );


    if (
      deleteError
    ) {

      throw deleteError;

    }


    const rows =
      cleanedStages.map(
        (
          stage,
          index
        ) => ({

          product_id:
            product.id,

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
      .insert(
        rows
      );


    if (
      insertError
    ) {

      throw insertError;

    }


    $("workflowMessage")
      .classList
      .add(
        "success-message"
      );


    $("workflowMessage")
      .textContent =
        "Production workflow saved.";


    await loadWorkflow();


  } catch (error) {

    console.error(
      "Workflow save failed:",
      error
    );


    $("workflowMessage")
      .classList
      .remove(
        "success-message"
      );


    $("workflowMessage")
      .textContent =
        error?.message ||
        "Unable to save production workflow.";


  } finally {

    resetButton(
      $("saveWorkflowButton"),
      "Save Workflow"
    );

  }

}


function clearWorkflowMessage() {

  $("workflowMessage")
    .textContent =
      "";


  $("workflowMessage")
    .classList
    .remove(
      "success-message"
    );

}


// Workflow navigation
$("workflowBackButton")
  .addEventListener(
    "click",
    () => {

      workflowProductId =
        null;

      workflowProductName =
        "";

      workflowStages =
        [];

      navigate(
        "products"
      );

    }
  );


$("cancelWorkflowButton")
  .addEventListener(
    "click",
    () => {

      workflowProductId =
        null;

      workflowProductName =
        "";

      workflowStages =
        [];

      navigate(
        "products"
      );

    }
  );


$("workflowLogoutButton")
  .addEventListener(
    "click",
    logout
  );


// ============================================================
// QR MANAGEMENT
// ============================================================

async function loadQrManagement() { await loadQrProducts(); await loadQrSeries(); }

async function loadQrProducts() {
  const select = $("qrProduct");
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = ""; placeholder.textContent = "Select product";
  select.appendChild(placeholder);
  const user = await getCurrentUser();
  const { data, error } = await supabase.from("products").select("id,name,is_active").eq("seller_id", user.id).eq("is_active", true).order("name", {ascending:true});
  if (error) throw error;
  qrProducts = data || [];
  qrProducts.forEach(product => { const option=document.createElement("option"); option.value=product.id; option.textContent=product.name; select.appendChild(option); });
}

async function loadQrSeries() {

  const list =
    $("qrSeriesList");


  /*
   * Always replace the list from one database snapshot.
   * Never append a second copy onto an existing render.
   */

  list.replaceChildren();


  $("emptyQrState")
    .hidden =
      true;


  const user =
    await getCurrentUser();


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
      product_id,
      series_name,
      series_sequence,
      code,
      status,
      created_at,
      products(name)
    `)
    .eq(
      "seller_id",
      user.id
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


  if (
    getRoute() !==
    "qr"
  ) {

    return;

  }


  const groups =
    new Map();


  (data || []).forEach(
    (qr) => {

      const key =
        `${qr.product_id}::${qr.series_name}`;


      if (
        !groups.has(key)
      ) {

        groups.set(
          key,
          {

            productId:
              qr.product_id,

            productName:
              qr.products?.name ||
              "Product",

            seriesName:
              qr.series_name ||
              "Unnamed Series",

            total:
              0,

            available:
              0,

            assigned:
              0,

            revoked:
              0

          }
        );

      }


      const group =
        groups.get(key);


      group.total +=
        1;


      if (
        qr.status ===
        "available"
      ) {

        group.available +=
          1;

      } else if (
        qr.status ===
        "assigned"
      ) {

        group.assigned +=
          1;

      } else if (
        qr.status ===
        "revoked"
      ) {

        group.revoked +=
          1;

      }

    }
  );


  if (
    groups.size ===
    0
  ) {

    $("emptyQrState")
      .hidden =
        false;

    return;

  }


  const fragment =
    document.createDocumentFragment();


  for (
    const group
    of groups.values()
  ) {

    fragment.appendChild(
      createQrSeriesCard(
        group
      )
    );

  }


  list.replaceChildren(
    fragment
  );

}

function createQrSeriesCard(group){

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
    group.seriesName;


  const product =
    document.createElement(
      "p"
    );

  product.textContent =
    `Product: ${group.productName}`;


  const total =
    document.createElement(
      "p"
    );

  total.textContent =
    `Total: ${group.total} pairs`;


  const status =
    document.createElement(
      "p"
    );

  status.className =
    "qr-series-status";


  status.textContent =
    `Available: ${group.available} · Assigned: ${group.assigned} · Revoked: ${group.revoked}`;


  const actions =
    document.createElement(
      "div"
    );

  actions.className =
    "qr-series-actions";


  const print =
    document.createElement(
      "button"
    );

  print.type =
    "button";

  print.textContent =
    "Print";

  print.disabled =
    group.available < 1;

  print.addEventListener(
    "click",
    () => {
      openQrPrintPanel(
        group
      );
    }
  );


  actions.appendChild(
    print
  );


  card.append(
    title,
    product,
    total,
    status,
    actions
  );


  return card;

}

$("qrSeriesForm").addEventListener("submit",async event=>{
  event.preventDefault(); clearQrMessage();
  const productId=$("qrProduct").value, seriesName=$("qrSeriesName").value.trim(), quantity=Number($("qrQuantity").value);
  if(!productId){$("qrMessage").textContent="Select a product.";return;}
  if(!seriesName){$("qrMessage").textContent="Enter a series name.";return;}
  if(!Number.isInteger(quantity)||quantity<1||quantity>5000){$("qrMessage").textContent="Enter a quantity between 1 and 5000.";return;}
  setLoading($("generateQrButton"),"Generating...");
  try {
    const {data,error}=await supabase.rpc("generate_qr_series",{requested_product_id:productId,requested_series_name:seriesName,requested_quantity:quantity});
    if(error) throw error;
    console.log("Generated QR series:",data); $("qrSeriesForm").reset(); $("qrMessage").textContent=`Generated ${quantity} QR pairs successfully.`; $("qrMessage").classList.add("success-message"); await loadQrSeries();
  } catch(error){ console.error("QR generation failed:",error); $("qrMessage").textContent=error?.message||"Unable to generate QR series."; }
  finally { resetButton($("generateQrButton"),"Generate QR Series"); }
});

$("qrButton").addEventListener("click",()=>navigate("qr"));
$("qrBackButton").addEventListener("click",()=>navigate("home"));
$("qrLogoutButton").addEventListener("click",logout);

function clearQrMessage(){ $("qrMessage").textContent=""; $("qrMessage").classList.remove("success-message"); }


// ============================================================
// QR PRINTING
// ============================================================

let activePrintSeries = null;


function openQrPrintPanel(
  group
) {

  activePrintSeries =
    group;

  $("qrPrintPanel")
    .hidden =
      false;

  $("qrPrintQuantity")
    .value =
      Math.min(
        10,
        Number(group.available) || 1
      );

  clearQrPrintMessage();

  $("qrPrintPreview")
    .replaceChildren();

  $("qrPrintPanel")
    .scrollIntoView({
      behavior:
        "smooth",
      block:
        "start"
    });

}


function closeQrPrintPanel() {

  activePrintSeries =
    null;

  $("qrPrintPanel")
    .hidden =
      true;

  $("qrPrintPreview")
    .replaceChildren();

  clearQrPrintMessage();

}


async function prepareQrPrintPreview() {

  clearQrPrintMessage();


  if (!activePrintSeries) {

    $("qrPrintMessage")
      .textContent =
        "No QR series selected.";

    return;

  }


  const quantity =
    Number(
      $("qrPrintQuantity")
        .value
    );


  if (
    !Number.isInteger(
      quantity
    ) ||
    quantity < 1
  ) {

    $("qrPrintMessage")
      .textContent =
        "Enter a valid number of pairs.";

    return;

  }


  setLoading(
    $("prepareQrPrintButton"),
    "Preparing..."
  );


  try {

    const user =
      await getCurrentUser();


    const {
      data:
        seller,
      error:
        sellerError
    } =
    await supabase
      .from(
        "sellers"
      )
      .select(
        "shop_name"
      )
      .eq(
        "id",
        user.id
      )
      .single();


    if (sellerError) {

      throw sellerError;

    }


    const {
      data:
        product,
      error:
        productError
    } =
    await supabase
      .from(
        "products"
      )
      .select(
        "id,name"
      )
      .eq(
        "id",
        activePrintSeries.productId
      )
      .eq(
        "seller_id",
        user.id
      )
      .single();


    if (productError) {

      throw productError;

    }


    const {
      data:
        qrRows,
      error:
        qrError
    } =
    await supabase
      .from(
        "qr_codes"
      )
      .select(`
        id,
        code,
        public_token,
        series_name,
        series_sequence
      `)
      .eq(
        "seller_id",
        user.id
      )
      .eq(
        "product_id",
        activePrintSeries.productId
      )
      .eq(
        "series_name",
        activePrintSeries.seriesName
      )
      .eq(
        "status",
        "available"
      )
      .order(
        "series_sequence",
        {
          ascending:
            true
        }
      )
      .limit(
        quantity
      );


    if (qrError) {

      throw qrError;

    }


    if (
      !qrRows ||
      qrRows.length <
        quantity
    ) {

      throw new Error(
        `Only ${qrRows?.length || 0} available QR pair${(qrRows?.length || 0) === 1 ? "" : "s"} remain in this series.`
      );

    }


    $("qrPrintPreview")
      .replaceChildren();


    qrRows.forEach(
      (
        qr,
        index
      ) => {

        $("qrPrintPreview")
          .appendChild(
            createQrPair(
              seller.shop_name,
              product.name,
              qr,
              index + 1
            )
          );

      }
    );


    $("qrPrintMessage")
      .classList
      .add(
        "success-message"
      );


    $("qrPrintMessage")
      .textContent =
        `${qrRows.length} QR pair${qrRows.length === 1 ? "" : "s"} ready to print.`;


  } catch (error) {

    console.error(
      "QR print preparation failed:",
      error
    );


    $("qrPrintPreview")
      .replaceChildren();


    $("qrPrintMessage")
      .textContent =
        error?.message ||
        "Unable to prepare print preview.";

  } finally {

    resetButton(
      $("prepareQrPrintButton"),
      "Prepare Preview"
    );

  }

}


function createQrPair(
  shopName,
  productName,
  qr,
  pairNumber
) {

  const pair =
    document.createElement(
      "section"
    );

  pair.className =
    "qr-print-pair";


  pair.append(
    createQrCard(
      "SELLER COPY",
      shopName,
      productName,
      qr,
      false
    )
  );


  const connector =
    document.createElement(
      "div"
    );

  connector.className =
    "qr-pair-cut-guide";

  connector.innerHTML =
    `<span class="cut-scissors">✂</span><span>Cut here</span>`;


  pair.appendChild(
    connector
  );


  pair.append(
    createQrCard(
      "CUSTOMER COPY",
      shopName,
      productName,
      qr,
      true
    )
  );


  return pair;

}


function createQrCard(
  copyLabel,
  shopName,
  productName,
  qr,
  customerCopy
) {

  const card =
    document.createElement(
      "div"
    );

  card.className =
    "qr-print-card";


  const label =
    document.createElement(
      "div"
    );

  label.className =
    "qr-card-copy-label";

  label.textContent =
    copyLabel;


  const shop =
    document.createElement(
      "div"
    );

  shop.className =
    "qr-card-shop";

  shop.textContent =
    shopName;


  const product =
    document.createElement(
      "div"
    );

  product.className =
    "qr-card-product";

  product.textContent =
    productName;


  const qrHolder =
    document.createElement(
      "div"
    );

  qrHolder.className =
    "qr-code-holder";


  const qrUrl =
    `${window.location.origin}/t/${qr.public_token}`;


  new QRCode(
    qrHolder,
    {
      text:
        qrUrl,
      width:
        108,
      height:
        108,
      correctLevel:
        QRCode.CorrectLevel.M
    }
  );


  card.append(
    label,
    shop,
    product,
    qrHolder
  );


  if (
    customerCopy
  ) {

    const instruction =
      document.createElement(
        "div"
      );

    instruction.className =
      "qr-card-instruction";

    instruction.textContent =
      "Scan to track your order";


    const url =
      document.createElement(
        "div"
      );

    url.className =
      "qr-card-url";

    url.textContent =
      qrUrl;


    card.append(
      instruction,
      url
    );

  } else {

    const code =
      document.createElement(
        "div"
      );

    code.className =
      "qr-card-code";

    code.textContent =
      qr.code;


    card.appendChild(
      code
    );

  }


  return card;

}


function clearQrPrintMessage() {

  $("qrPrintMessage")
    .textContent =
      "";

  $("qrPrintMessage")
    .classList
    .remove(
      "success-message"
    );

}


$("closeQrPrintButton")
  .addEventListener(
    "click",
    closeQrPrintPanel
  );


$("prepareQrPrintButton")
  .addEventListener(
    "click",
    prepareQrPrintPreview
  );


$("printQrPairsButton")
  .addEventListener(
    "click",
    () => {

      if (
        !$("qrPrintPreview")
          .children
          .length
      ) {

        $("qrPrintMessage")
          .textContent =
            "Prepare the preview first.";

        return;

      }


      window.print();

    }
  );



// ============================================================
// SELLER QR SCANNER / ORDER CREATION
// ============================================================

$("homeScanButton")
  .addEventListener(
    "click",
    () => {

      pendingQrToken =
        null;

      pendingProduct =
        null;

      navigate(
        "scanner"
      );

    }
  );


$("scannerBackButton")
  .addEventListener(
    "click",
    async () => {

      await stopQrScanner();

      navigate(
        "home"
      );

    }
  );


$("scannerManualButton")
  .addEventListener(
    "click",
    async () => {

      const value =
        window.prompt(
          "Enter the QR tracking URL or token:"
        );


      if (
        !value
      ) {

        return;

      }


      await handleScannedQr(
        value
      );

    }
  );


async function startQrScanner() {

  if (
    scannerInstance ||
    typeof Html5Qrcode ===
      "undefined"
  ) {

    if (
      typeof Html5Qrcode ===
      "undefined"
    ) {

      $("scannerMessage")
        .textContent =
          "QR scanner library could not be loaded.";

    }

    return;

  }


  scannerInstance =
    new Html5Qrcode(
      "qrReader"
    );


  try {

    await scannerInstance.start(
      {
        facingMode:
          "environment"
      },
      {
        fps:
          10,

        qrbox:
          {
            width:
              250,

            height:
              250
          }
      },
      async (
        decodedText
      ) => {

        await handleScannedQr(
          decodedText
        );

      },
      () => {}
    );


  } catch (error) {

    console.error(
      "Camera start failed:",
      error
    );


    $("scannerMessage")
      .textContent =
        "Unable to access the camera. Check camera permission or use manual QR entry.";


    await stopQrScanner();

  }

}


async function stopQrScanner() {

  if (
    !scannerInstance
  ) {

    return;

  }


  try {

    if (
      scannerInstance.isScanning
    ) {

      await scannerInstance.stop();

    }


    await scannerInstance.clear();


  } catch (
    error
  ) {

    console.warn(
      "Scanner cleanup failed:",
      error
    );


  } finally {

    scannerInstance =
      null;

  }

}


function extractQrToken(
  value
) {

  const text =
    String(
      value ||
      ""
    ).trim();


  if (
    !text
  ) {

    return null;

  }


  try {

    const url =
      new URL(
        text
      );


    const match =
      url.pathname.match(
        /^\/t\/([^/]+)\/?$/
      );


    if (
      match?.[1]
    ) {

      return match[1];

    }

  } catch {
    /*
     * Raw token is accepted below.
     */

  }


  return text;

}


async function handleScannedQr(
  scannedText
) {

  if (
    qrScanBusy
  ) {

    return;

  }


  qrScanBusy =
    true;


  try {

    const token =
      extractQrToken(
        scannedText
      );


    if (
      !token
    ) {

      throw new Error(
        "The scanned QR does not contain a valid Ordeli tracking token."
      );

    }


    await stopQrScanner();


    const user =
      await getCurrentUser();


    const {
      data:
        qr,
      error
    } =
    await supabase
      .from(
        "qr_codes"
      )
      .select(`
        id,
        product_id,
        code,
        public_token,
        status,
        order_item_id,
        products(
          id,
          name,
          default_price
        )
      `)
      .eq(
        "seller_id",
        user.id
      )
      .eq(
        "public_token",
        token
      )
      .single();


    if (
      error
    ) {

      throw new Error(
        "This QR code was not found in your shop."
      );

    }


    pendingQrToken =
      qr.public_token;


    pendingProduct =
      qr.products;


    if (
      qr.status ===
      "available"
    ) {

      prepareOrderCreation(
        qr
      );

      navigate(
        "order-create"
      );

      return;

    }


    if (
      qr.status ===
        "assigned" &&
      qr.order_item_id
    ) {

      currentOrderId =
        await getOrderIdFromItem(
          qr.order_item_id
        );

      navigate(
        "order-detail"
      );

      return;

    }


    if (
      qr.status ===
      "revoked"
    ) {

      throw new Error(
        "This QR code has been revoked."
      );

    }


    throw new Error(
      "This QR code is not currently available."
    );


  } catch (error) {

    console.error(
      "QR scan failed:",
      error
    );


    $("scannerMessage")
      .textContent =
        error?.message ||
        "Unable to process the scanned QR code.";


    if (
      !scannerInstance &&
      getRoute() ===
        "scanner"
    ) {

      setTimeout(
        () => {

          startQrScanner();

        },
        500
      );

    }

  } finally {

    qrScanBusy =
      false;

  }

}


async function getOrderIdFromItem(
  orderItemId
) {

  const {
    data,
    error
  } =
  await supabase
    .from(
      "order_items"
    )
    .select(
      "order_id"
    )
    .eq(
      "id",
      orderItemId
    )
    .single();


  if (
    error
  ) {

    throw error;

  }


  return data.order_id;

}


// ============================================================
// ORDER CREATION
// ============================================================

function prepareOrderCreation(
  qr
) {

  pendingQrToken =
    qr.public_token;

  pendingProduct =
    qr.products;


  $("orderDetectedProduct")
    .textContent =
      qr.products?.name ||
      "Product";


  $("orderDetectedPrice")
    .textContent =
      formatPrice(
        qr.products?.default_price
      );


  $("orderQuantity")
    .value =
      "1";


  $("orderDownpayment")
    .value =
      "0";


  $("newCustomerChoice")
    .checked =
      true;


  $("existingCustomerChoice")
    .checked =
      false;


  toggleCustomerChoice();


  clearOrderMessage();

  updateOrderCreateTotals();

  loadActiveCustomers();

}


async function loadActiveCustomers() {

  const select =
    $("existingCustomerSelect");


  select.replaceChildren();


  const placeholder =
    document.createElement(
      "option"
    );


  placeholder.value =
    "";


  placeholder.textContent =
    "Select active customer";


  select.appendChild(
    placeholder
  );


  try {

    const user =
      await getCurrentUser();


    /*
     * Active means the customer has at least one
     * non-cancelled order still in progress.
     *
     * At this stage, "in progress" uses the order's
     * non-cancelled state. The final completed-state
     * derivation is implemented later with production.
     */

    const {
      data,
      error
    } =
    await supabase
      .from(
        "customers"
      )
      .select(`
        id,
        name,
        phone,
        orders!inner(
          id,
          cancelled_at
        )
      `)
      .eq(
        "seller_id",
        user.id
      )
      .is(
        "orders.cancelled_at",
        null
      )
      .order(
        "name",
        {
          ascending:
            true
        }
      );


    if (
      error
    ) {

      console.warn(
        "Active customers could not be loaded:",
        error
      );

      return;

    }


    const unique =
      new Map();


    (
      data || []
    ).forEach(
      (
        customer
      ) => {

        unique.set(
          customer.id,
          customer
        );

      }
    );


    unique.forEach(
      (
        customer
      ) => {

        const option =
          document.createElement(
            "option"
          );


        option.value =
          customer.id;


        option.textContent =
          customer.phone
            ? `${customer.name} — ${customer.phone}`
            : customer.name;


        select.appendChild(
          option
        );

      }
    );

  } catch (
    error
  ) {

    console.warn(
      "Active customer loading failed:",
      error
    );

  }

}


function toggleCustomerChoice() {

  const existing =
    $("existingCustomerChoice")
      .checked;


  $("newCustomerFields")
    .hidden =
      existing;


  $("existingCustomerFields")
    .hidden =
      !existing;


  $("orderCustomerName")
    .required =
      !existing;

}


$("newCustomerChoice")
  .addEventListener(
    "change",
    toggleCustomerChoice
  );


$("existingCustomerChoice")
  .addEventListener(
    "change",
    toggleCustomerChoice
  );


function updateOrderCreateTotals() {

  const price =
    Number(
      pendingProduct?.default_price
    ) || 0;


  const quantity =
    Number(
      $("orderQuantity")
        .value
    ) || 0;


  const total =
    price *
    quantity;


  let downpayment =
    Number(
      $("orderDownpayment")
        .value
    );


  if (
    !Number.isFinite(
      downpayment
    ) ||
    downpayment <
      0
  ) {

    downpayment =
      0;

  }


  $("orderCreateTotal")
    .textContent =
      formatPrice(
        total
      );


  $("orderCreateBalance")
    .textContent =
      formatPrice(
        Math.max(
          0,
          total -
          Math.min(
            downpayment,
            total
          )
        )
      );

}


$("orderQuantity")
  .addEventListener(
    "input",
    updateOrderCreateTotals
  );


$("orderDownpayment")
  .addEventListener(
    "input",
    updateOrderCreateTotals
  );


$("orderCreateForm")
  .addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();

      await createOrder();

    }
  );


async function createOrder() {

  clearOrderMessage();


  if (
    !pendingQrToken ||
    !pendingProduct
  ) {

    $("orderCreateMessage")
      .textContent =
        "No scanned product QR is selected.";

    return;

  }


  const quantity =
    Number(
      $("orderQuantity")
        .value
    );


  const downpayment =
    Number(
      $("orderDownpayment")
        .value
    ) || 0;


  const total =
    (
      Number(
        pendingProduct
          .default_price
      ) || 0
    ) *
    quantity;


  if (
    !Number.isInteger(
      quantity
    ) ||
    quantity <
      1
  ) {

    $("orderCreateMessage")
      .textContent =
        "Quantity must be at least 1.";

    return;

  }


  if (
    downpayment <
      0 ||
    downpayment >
      total
  ) {

    $("orderCreateMessage")
      .textContent =
        "Downpayment must be between ₱0 and the order total.";

    return;

  }


  const usingExisting =
    $("existingCustomerChoice")
      .checked;


  let customerId =
    null;


  let customerName =
    null;


  let customerPhone =
    null;


  if (
    usingExisting
  ) {

    customerId =
      $("existingCustomerSelect")
        .value;


    if (
      !customerId
    ) {

      $("orderCreateMessage")
        .textContent =
          "Select an active customer.";

      return;

    }

  } else {

    customerName =
      $("orderCustomerName")
        .value
        .trim();


    customerPhone =
      $("orderCustomerPhone")
        .value
        .trim() ||
      null;


    if (
      !customerName
    ) {

      $("orderCreateMessage")
        .textContent =
          "Customer name is required.";

      return;

    }

  }


  setLoading(
    $("orderSaveButton"),
    "Saving Order..."
  );


  try {

    const {
      data,
      error
    } =
    await supabase
      .rpc(
        "create_order_from_qr",
        {

          p_qr_public_token:
            pendingQrToken,

          p_customer_id:
            customerId,

          p_customer_name:
            customerName,

          p_customer_phone:
            customerPhone,

          p_quantity:
            quantity,

          p_downpayment:
            downpayment

        }
      );


    if (
      error
    ) {

      throw error;

    }


    if (
      !data?.order_id
    ) {

      throw new Error(
        "The order was not created."
      );

    }


    currentOrderId =
      data.order_id;


    navigate(
      "order-detail"
    );


  } catch (
    error
  ) {

    console.error(
      "Order creation failed:",
      error
    );


    $("orderCreateMessage")
      .textContent =
        error?.message ||
        "Unable to create the order.";

  } finally {

    resetButton(
      $("orderSaveButton"),
      "Save Order"
    );

  }

}


function clearOrderMessage() {

  $("orderCreateMessage")
    .textContent =
      "";

}


// ============================================================
// ORDER DETAILS
// ============================================================

async function loadOrderDetail(
  orderId
) {

  currentOrderTotal =
    0;

  currentOrderPaid =
    0;



  $("orderDetailItems")
    .replaceChildren();


  $("orderDetailMessage")
    .textContent =
      "";


  const user =
    await getCurrentUser();


  const {
    data:
      order,
    error:
      orderError
  } =
  await supabase
    .from(
      "orders"
    )
    .select(`
      id,
      order_number,
      customer_id,
      created_at,
      customers(
        id,
        name,
        phone
      )
    `)
    .eq(
      "id",
      orderId
    )
    .eq(
      "seller_id",
      user.id
    )
    .single();


  if (
    orderError
  ) {

    throw orderError;

  }


  $("orderDetailTitle")
    .textContent =
      `Order #${order.order_number}`;


  $("orderDetailNumber")
    .textContent =
      `#${order.order_number}`;


  $("orderDetailCustomerName")
    .textContent =
      order.customers?.name ||
      "Customer";


  $("orderDetailCustomer")
    .textContent =
      order.customers?.phone ||
      "";


  const {
    data:
      items,
    error:
      itemsError
  } =
  await supabase
    .from(
      "order_items"
    )
    .select(`
      id,
      product_name,
      quantity,
      unit_price,
      total_price,
      cancelled_at
    `)
    .eq(
      "order_id",
      orderId
    )
    .eq(
      "seller_id",
      user.id
    )
    .order(
      "created_at",
      {
        ascending:
          true
      }
    );


  if (
    itemsError
  ) {

    throw itemsError;

  }


  let total =
    0;


  (items || []).forEach(
    (
      item
    ) => {

      total +=
        Number(
          item.total_price
        ) || 0;


      const row =
        document.createElement(
          "div"
        );


      row.className =
        "order-detail-item";


      const left =
        document.createElement(
          "div"
        );


      const name =
        document.createElement(
          "strong"
        );


      name.textContent =
        item.product_name;


      const qty =
        document.createElement(
          "span"
        );


      qty.textContent =
        ` × ${item.quantity}`;


      left.append(
        name,
        qty
      );


      const price =
        document.createElement(
          "strong"
        );


      price.textContent =
        formatPrice(
          item.total_price
        );


      row.append(
        left,
        price
      );


      if (
        item.cancelled_at
      ) {

        row.classList.add(
          "is-cancelled"
        );

      }


      $("orderDetailItems")
        .appendChild(
          row
        );

    }
  );


  const {
    data:
      payments,
    error:
      paymentsError
  } =
  await supabase
    .from(
      "payments"
    )
    .select(
      "amount,proof_status"
    )
    .eq(
      "order_id",
      orderId
    )
    .eq(
      "seller_id",
      user.id
    );


  if (
    paymentsError
  ) {

    throw paymentsError;

  }


  const paid =
    (
      payments ||
      []
    ).reduce(
      (
        sum,
        payment
      ) =>
        sum +
        (
          Number(
            payment.amount
          ) || 0
        ),
      0
    );


  $("orderDetailTotal")
    .textContent =
      formatPrice(
        total
      );


  $("orderDetailPaid")
    .textContent =
      formatPrice(
        paid
      );


  currentOrderTotal =
    total;

  currentOrderPaid =
    paid;

  $("orderDetailBalance")
    .textContent =
      formatPrice(
        Math.max(
          0,
          total -
          paid
        )
      );

  await loadPayments(
    orderId
  );

}


// ============================================================
// PAYMENTS
// ============================================================

async function loadPayments(
  orderId
) {

  const list =
    $("paymentList");


  list.replaceChildren();


  const user =
    await getCurrentUser();


  const {
    data:
      payments,
    error
  } =
  await supabase
    .from(
      "payments"
    )
    .select(`
      id,
      amount,
      payment_type,
      proof_status,
      created_at
    `)
    .eq(
      "order_id",
      orderId
    )
    .eq(
      "seller_id",
      user.id
    )
    .order(
      "created_at",
      {
        ascending:
          true
      }
    );


  if (error) {
    throw error;
  }


  if (
    !payments ||
    payments.length === 0
  ) {

    const empty =
      document.createElement(
        "p"
      );

    empty.className =
      "payment-empty";

    empty.textContent =
      "No payments recorded yet.";

    list.appendChild(
      empty
    );

    return;

  }


  const fragment =
    document.createDocumentFragment();


  payments.forEach(
    (
      payment,
      index
    ) => {

      const row =
        document.createElement(
          "div"
        );

      row.className =
        "payment-row";


      const left =
        document.createElement(
          "div"
        );


      const title =
        document.createElement(
          "strong"
        );

      title.textContent =
        paymentTypeLabel(
          payment.payment_type
        );


      const meta =
        document.createElement(
          "span"
        );

      meta.textContent =
        formatDate(
          payment.created_at
        );


      left.append(
        title,
        meta
      );


      const right =
        document.createElement(
          "div"
        );

      right.className =
        "payment-row-right";


      const amount =
        document.createElement(
          "strong"
        );

      amount.textContent =
        formatPrice(
          payment.amount
        );


      const status =
        document.createElement(
          "span"
        );

      status.className =
        "payment-status";


      status.textContent =
        payment.proof_status
          ? payment.proof_status
          : "Confirmed";


      right.append(
        amount,
        status
      );


      row.append(
        left,
        right
      );


      fragment.appendChild(
        row
      );

    }
  );


  list.appendChild(
    fragment
  );

}


function openPaymentEditor() {

  clearPaymentMessage();


  const remaining =
    Math.max(
      0,
      currentOrderTotal -
      currentOrderPaid
    );


  if (
    remaining <= 0
  ) {

    $("paymentMessage")
      .textContent =
        "This order is already fully paid.";


    $("paymentEditor")
      .hidden =
        false;


    return;

  }


  $("paymentAmount")
    .value =
      remaining.toFixed(
        2
      );


  $("paymentType")
    .value =
      "additional";


  $("paymentEditor")
    .hidden =
      false;


  $("paymentAmount")
    .focus();

}


function closePaymentEditor() {

  $("paymentEditor")
    .hidden =
      true;


  $("paymentAmount")
    .value =
      "";


  clearPaymentMessage();

}


async function savePayment() {

  clearPaymentMessage();


  const amount =
    Number(
      $("paymentAmount")
        .value
    );


  const remaining =
    Math.max(
      0,
      currentOrderTotal -
      currentOrderPaid
    );


  if (
    !Number.isFinite(
      amount
    ) ||
    amount <=
      0
  ) {

    $("paymentMessage")
      .textContent =
        "Enter a valid payment amount.";

    return;

  }


  if (
    amount >
    remaining
  ) {

    $("paymentMessage")
      .textContent =
        "Payment cannot exceed the remaining balance.";

    return;

  }


  setLoading(
    $("savePaymentButton"),
    "Saving..."
  );


  try {

    const user =
      await getCurrentUser();


    const {
      data:
        order,
      error:
        orderError
    } =
    await supabase
      .from(
        "orders"
      )
      .select(
        "id"
      )
      .eq(
        "id",
        currentOrderId
      )
      .eq(
        "seller_id",
        user.id
      )
      .single();


    if (
      orderError
    ) {

      throw orderError;

    }


    const {
      error:
        insertError
    } =
    await supabase
      .from(
        "payments"
      )
      .insert({

        order_id:
          order.id,

        seller_id:
          user.id,

        amount,

        payment_type:
          $("paymentType")
            .value,

        proof_status:
          null

      });


    if (
      insertError
    ) {

      throw insertError;

    }


    closePaymentEditor();


    await loadOrderDetail(
      currentOrderId
    );


  } catch (
    error
  ) {

    console.error(
      "Payment save failed:",
      error
    );


    $("paymentMessage")
      .textContent =
        error?.message ||
        "Unable to record payment.";

  } finally {

    resetButton(
      $("savePaymentButton"),
      "Record Payment"
    );

  }

}


function clearPaymentMessage() {

  $("paymentMessage")
    .textContent =
      "";

}


function paymentTypeLabel(
  value
) {

  switch (
    value
  ) {

    case "downpayment":
      return "Downpayment";

    case "additional":
      return "Additional Payment";

    case "final":
      return "Final Payment";

    case "cash":
      return "Cash Payment";

    default:
      return "Payment";

  }

}


function formatDate(
  value
) {

  const date =
    new Date(
      value
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return "";

  }


  return new Intl.DateTimeFormat(
    "en-PH",
    {
      dateStyle:
        "medium",
      timeStyle:
        "short"
    }
  ).format(
    date
  );

}


$("addPaymentButton")
  .addEventListener(
    "click",
    openPaymentEditor
  );


$("cancelPaymentButton")
  .addEventListener(
    "click",
    closePaymentEditor
  );


$("savePaymentButton")
  .addEventListener(
    "click",
    savePayment
  );


$("orderDetailAddItemButton")
  .addEventListener(
    "click",
    () => {

      pendingQrToken =
        null;

      pendingProduct =
        null;

      navigate(
        "scanner"
      );

    }
  );


$("orderCreateBackButton")
  .addEventListener(
    "click",
    () => {

      pendingQrToken =
        null;

      pendingProduct =
        null;

      navigate(
        "home"
      );

    }
  );


$("orderCancelButton")
  .addEventListener(
    "click",
    () => {

      pendingQrToken =
        null;

      pendingProduct =
        null;

      navigate(
        "home"
      );

    }
  );


$("orderDetailBackButton")
  .addEventListener(
    "click",
    () => {

      currentOrderId =
        null;

      navigate(
        "home"
      );

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
    await supabase
      .auth
      .signOut();


    if (error) {

      throw error;

    }


    workflowProductId =
      null;


    workflowStages =
      [];


    editingProductId =
      null;


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



// ============================================================
// CUSTOMER TRACKING
// ============================================================

let trackingPayload = null;
let trackingOrderVisible = false;


async function renderTrackingPage(
  publicToken
) {

  showScreen(
    "tracking"
  );

  if (
    !(
      trackingPayload &&
      trackingPayload._token ===
        publicToken
    )
  ) {

    await loadCustomerTracking(
      publicToken
    );

  } else {

    renderCustomerTracking(
      trackingPayload
    );

  }

}


async function loadCustomerTracking(
  publicToken
) {

  trackingOrderVisible =
    false;

  trackingPayload =
    null;

  $("trackingLoadingState").hidden =
    false;
  $("trackingErrorState").hidden =
    true;
  $("trackingContent").hidden =
    true;

  try {

    const {
      data,
      error
    } =
      await supabase.rpc(
        "get_customer_tracking",
        {
          p_public_token: publicToken
        }
      );

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error(
        "Tracking information is not available."
      );
    }

    trackingPayload = {
      ...data,
      _token: publicToken
    };

    renderCustomerTracking(
      trackingPayload
    );

  } catch (error) {

    console.error(
      "Customer tracking load failed:",
      error
    );

    $("trackingLoadingState").hidden =
      true;
    $("trackingContent").hidden =
      true;
    $("trackingErrorState").hidden =
      false;

    $("trackingErrorMessage").textContent =
      error?.message ||
      "This tracking link could not be loaded.";

  }

}


function renderCustomerTracking(
  payload
) {

  $("trackingLoadingState").hidden =
    true;
  $("trackingErrorState").hidden =
    true;
  $("trackingContent").hidden =
    false;

  const shop =
    payload?.shop || {};
  const order =
    payload?.order || {};
  const item =
    payload?.item || {};
  const payment =
    payload?.payment || {};

  $("trackingShopName").textContent =
    shop.name ||
    "Shop";

  $("trackingOrderNumber").textContent =
    `#${order.order_number ?? "—"}`;

  $("trackingProductName").textContent =
    item.product_name ||
    "Product";

  $("trackingProductQuantity").textContent =
    `Quantity: ${Number(item.quantity) || 0}`;

  const itemCancelled =
    Boolean(item.cancelled_at);
  const orderCancelled =
    Boolean(order.cancelled_at);

  const productionStatus =
    itemCancelled
      ? "Cancelled"
      : item.production_completed
        ? "Completed"
        : "In Progress";

  $("trackingItemStatus").textContent =
    orderCancelled
      ? "Order Cancelled"
      : productionStatus;

  $("trackingItemStatus").className =
    `tracking-status-badge ${
      orderCancelled || itemCancelled
        ? "is-cancelled"
        : productionStatus === "Completed"
          ? "is-complete"
          : ""
    }`;

  if (orderCancelled || itemCancelled) {

    $("trackingProductionSummary").textContent =
      "This order item is no longer active.";

  } else if (item.production_completed) {

    $("trackingProductionSummary").textContent =
      "All production stages for this item are finished.";

  } else if (!item.production_stages?.length) {

    $("trackingProductionSummary").textContent =
      "Production stages have not been configured yet.";

  } else {

    $("trackingProductionSummary").textContent =
      "The production timeline updates as each stage is finished.";

  }

  renderTrackingStages(
    item.production_stages || []
  );

  $("trackingPaymentTotal").textContent =
    formatPrice(payment.total);

  $("trackingPaymentPaid").textContent =
    formatPrice(payment.paid);

  $("trackingPaymentRemaining").textContent =
    formatPrice(payment.remaining);

  $("trackingPaymentStatusText").textContent =
    trackingPaymentStatusLabel(
      payment.status
    );

  renderTrackingOrderItems(
    payload?.order_items || []
  );

  $("trackingOrderCard").hidden =
    !trackingOrderVisible;

  $("trackingViewOrderButton").textContent =
    trackingOrderVisible
      ? "Hide My Order"
      : "View My Order";

}


function renderTrackingStages(
  stages
) {

  const list =
    $("trackingStageList");

  list.replaceChildren();

  if (!stages.length) {

    const empty =
      document.createElement("p");

    empty.className =
      "tracking-stage-empty";
    empty.textContent =
      "No production stages have been added yet.";
    list.appendChild(empty);
    return;

  }

  const fragment =
    document.createDocumentFragment();

  stages.forEach(
    (stage) => {

      const row =
        document.createElement("div");
      row.className =
        `tracking-stage-row is-${stage.status || "upcoming"}`;

      const icon =
        document.createElement("span");
      icon.className =
        "tracking-stage-icon";
      icon.textContent =
        stage.status === "finished"
          ? "✓"
          : stage.status === "in_progress"
            ? "→"
            : "○";

      const body =
        document.createElement("div");
      body.className =
        "tracking-stage-body";

      const name =
        document.createElement("strong");
      name.textContent =
        stage.name ||
        `Stage ${stage.stage_order || ""}`;

      const status =
        document.createElement("span");
      status.textContent =
        stage.status === "finished"
          ? "Finished"
          : stage.status === "in_progress"
            ? "In Progress"
            : "Upcoming";

      body.append(
        name,
        status
      );

      row.append(
        icon,
        body
      );

      fragment.appendChild(
        row
      );

    }
  );

  list.appendChild(
    fragment
  );

}


function renderTrackingOrderItems(
  items
) {

  const list =
    $("trackingOrderItems");

  list.replaceChildren();

  const fragment =
    document.createDocumentFragment();

  items.forEach(
    (entry) => {

      const row =
        document.createElement("div");
      row.className =
        `tracking-order-item ${entry.cancelled ? "is-cancelled" : ""}`;

      const left =
        document.createElement("div");
      const name =
        document.createElement("strong");
      name.textContent =
        entry.product_name ||
        "Product";
      const quantity =
        document.createElement("span");
      quantity.textContent =
        ` × ${Number(entry.quantity) || 0}`;
      left.append(
        name,
        quantity
      );

      const status =
        document.createElement("span");
      status.textContent =
        trackingProductionStatusLabel(
          entry.production_status
        );

      row.append(
        left,
        status
      );

      fragment.appendChild(
        row
      );

    }
  );

  list.appendChild(
    fragment
  );

}


function trackingProductionStatusLabel(
  value
) {

  switch (value) {
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "pending":
      return "Pending";
    default:
      return "In Progress";
  }

}


function trackingPaymentStatusLabel(
  value
) {

  switch (value) {
    case "fully_paid":
      return "Fully Paid";
    case "partially_paid":
      return "Partially Paid";
    case "pending_verification":
      return "Payment Pending Verification";
    case "rejected":
      return "Payment Proof Rejected";
    default:
      return "Unpaid";
  }

}


$("trackingRefreshButton")
  .addEventListener(
    "click",
    () => {
      const token =
        getTrackingToken();
      if (token) {
        loadCustomerTracking(
          token
        );
      }
    }
  );


$("trackingViewOrderButton")
  .addEventListener(
    "click",
    () => {
      trackingOrderVisible =
        !trackingOrderVisible;
      renderCustomerTracking(
        trackingPayload
      );
    }
  );


// ============================================================
// COMMON HELPERS
// ============================================================

function populateShopForm(
  seller
) {

  $("shopName")
    .value =
      seller?.shop_name ||
      "";


  $("shopAddress")
    .value =
      seller?.shop_address ||
      "";


  $("shopLogo")
    .value =
      "";


  $("shopLogoPreviewContainer")
    .hidden =
      true;


  $("shopLogoPreview")
    .removeAttribute(
      "src"
    );

}


function validateLogo(
  file
) {

  const allowed = [
    "image/png",
    "image/jpeg",
    "image/webp"
  ];


  if (
    !allowed.includes(
      file.type
    )
  ) {

    throw new Error(
      "Shop logo must be PNG, JPEG, or WebP."
    );

  }


  if (
    file.size >
    5 *
    1024 *
    1024
  ) {

    throw new Error(
      "Shop logo must be 5 MB or smaller."
    );

  }

}


function safeExtension(
  fileName
) {

  const extension =
    fileName
      .split(".")
      .pop()
      .toLowerCase();


  return [
    "png",
    "jpg",
    "jpeg",
    "webp"
  ].includes(
    extension
  )
    ? extension
    : "jpg";

}


function setLoading(
  button,
  text
) {

  button.disabled =
    true;

  button.textContent =
    text;

}


function resetButton(
  button,
  text
) {

  button.disabled =
    false;

  button.textContent =
    text;

}


function clearMessages() {

  $("loginMessage")
    .textContent =
      "";

  $("registerMessage")
    .textContent =
      "";

  $("shopSetupMessage")
    .textContent =
      "";

}


function getAuthError(
  error
) {

  const message =
    String(
      error?.message ||
      ""
    );


  const lower =
    message.toLowerCase();


  if (
    lower.includes(
      "invalid login credentials"
    )
  ) {

    return (
      "Invalid email or password."
    );

  }


  if (
    lower.includes(
      "email not confirmed"
    )
  ) {

    return (
      "Please confirm your email before logging in."
    );

  }


  return (
    message ||
    "Authentication failed."
  );

}


function formatPrice(
  value
) {

  return new Intl.NumberFormat(
    "en-PH",
    {

      style:
        "currency",

      currency:
        "PHP"

    }
  ).format(
    Number(value) || 0
  );

}


// ============================================================
// AUTH STATE + ROUTING
// ============================================================

supabase.auth.onAuthStateChange(
  (
    _event,
    currentSession
  ) => {

    setTimeout(
      () => {

        if (
          getTrackingToken()
        ) {

          renderApplication();

        } else if (
          currentSession
        ) {

          renderApplication();

        } else {

          showScreen(
            getRoute() ===
              "register"
              ? "register"
              : "login"
          );

        }

      },
      0
    );

  }
);


window.addEventListener(
  "hashchange",
  async () => {

    if (
      getRoute() !== "scanner" &&
      scannerInstance
    ) {

      await stopQrScanner();

    }

    renderApplication();

  }
);


// ============================================================
// INITIALIZE
// ============================================================

renderApplication();
