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
    $("qrScreen")

};


// ============================================================
// STATE
// ============================================================

let editingProductId =
  null;

let workflowProductId =
  null;

let workflowProductName =
  "";

let workflowStages =
  [];

let qrProducts = [];


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
  "qr"
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

    renderApplication();

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

  try {

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

  $("productList")
    .innerHTML =
      "";


  $("emptyProductsState")
    .hidden =
      true;


  $("productEditor")
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
      "products"
    )
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
    .eq(
      "seller_id",
      user.id
    )
    .eq(
      "is_active",
      true
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

    $("emptyProductsState")
      .hidden =
        false;


    return;

  }


  data.forEach(
    (product) => {

      $("productList")
        .appendChild(
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
  const list=$("qrSeriesList"); list.replaceChildren(); $("emptyQrState").hidden=true;
  const user=await getCurrentUser();
  const {data,error}=await supabase.from("qr_codes").select(`id,product_id,series_name,series_sequence,code,status,created_at,products(name)`).eq("seller_id",user.id).order("created_at",{ascending:false});
  if(error) throw error;
  const groups=new Map();
  (data||[]).forEach(qr=>{ const key=`${qr.product_id}::${qr.series_name}`; if(!groups.has(key)) groups.set(key,{productId:qr.product_id,productName:qr.products?.name||"Product",seriesName:qr.series_name||"Unnamed Series",total:0,available:0,assigned:0,revoked:0}); const g=groups.get(key); g.total++; if(qr.status==="available")g.available++; else if(qr.status==="assigned")g.assigned++; else if(qr.status==="revoked")g.revoked++; });
  if(!groups.size){ $("emptyQrState").hidden=false; return; }
  const fragment=document.createDocumentFragment();
  for(const group of groups.values()) fragment.appendChild(createQrSeriesCard(group));
  list.appendChild(fragment);
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
    "qr-pair-connector";

  connector.textContent =
    `PAIR ${pairNumber}`;


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
  () => {

    renderApplication();

  }
);


// ============================================================
// INITIALIZE
// ============================================================

renderApplication();
