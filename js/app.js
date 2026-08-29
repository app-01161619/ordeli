import { supabase } from "./supabase.js";

const $ = (id) => document.getElementById(id);

const screens = {
  login: $("loginScreen"),
  register: $("registerScreen"),
  shopSetup: $("shopSetupScreen"),
  home: $("homeScreen"),
  products: $("productsScreen")
};

let editingProductId = null;

function getRoute() {
  const value = window.location.hash.replace(/^#/, "").toLowerCase();
  const routes = ["login", "register", "shop-setup", "home", "products"];
  return routes.includes(value) ? value : "login";
}

function navigate(route) {
  window.location.hash = route;
}

function showScreen(route) {
  const key = route === "shop-setup" ? "shopSetup" : route;
  Object.entries(screens).forEach(([name, element]) => {
    if (element) element.hidden = name !== key;
  });
}

async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("No authenticated user.");
  return data.user;
}

async function getSeller(userId) {
  const { data, error } = await supabase
    .from("sellers")
    .select("id,email,login_method,google_id,shop_name,shop_address,shop_logo_path")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function isShopComplete(seller) {
  return Boolean(seller?.shop_name?.trim() && seller?.shop_address?.trim());
}

async function renderApplication() {
  try {
    const session = await getSession();

    if (!session) {
      showScreen(getRoute() === "register" ? "register" : "login");
      return;
    }

    const seller = await getSeller(session.user.id);

    if (!seller) {
      throw new Error("Seller profile was not found. Run the new Seller/Shop SQL first, then sign in again.");
    }

    if (!isShopComplete(seller)) {
      populateShopForm(seller);
      showScreen("shop-setup");
      return;
    }

    $("homeShopName").textContent = seller.shop_name;
    $("homeShopAddress").textContent = seller.shop_address || "";

    await loadHomeLogo(seller.shop_logo_path);

    if (getRoute() === "products") {
      showScreen("products");
      await loadProducts();
      return;
    }

    if (getRoute() === "shop-profile") {
      populateShopForm(seller);
      showScreen("shop-setup");
      return;
    }

    showScreen("home");
  } catch (error) {
    console.error("Application render error:", error);
    showScreen("login");
    $("loginMessage").textContent =
      error?.message || "Unable to load the application.";
  }
}

async function loadHomeLogo(logoPath) {
  $("homeLogoContainer").hidden = true;
  $("homeLogo").removeAttribute("src");

  if (!logoPath) return;

  const { data, error } = await supabase
    .storage
    .from("shop-logos")
    .createSignedUrl(logoPath, 3600);

  if (error) {
    console.warn("Unable to load shop logo:", error);
    return;
  }

  if (data?.signedUrl) {
    $("homeLogo").src = data.signedUrl;
    $("homeLogoContainer").hidden = false;
  }
}

// ============================================================
// AUTH
// ============================================================

$("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessages();

  const email = $("registerEmail").value.trim().toLowerCase();
  const password = $("registerPassword").value;
  const confirm = $("registerConfirmPassword").value;

  if (!email) {
    $("registerMessage").textContent = "Email is required.";
    return;
  }

  if (password.length < 8) {
    $("registerMessage").textContent = "Password must be at least 8 characters.";
    return;
  }

  if (password !== confirm) {
    $("registerMessage").textContent = "Passwords do not match.";
    return;
  }

  setLoading($("registerButton"), "Creating...");

  try {
    const { data, error } =
      await supabase.auth.signUp({
        email,
        password
      });

    if (error) throw error;

    if (data.session) {
      navigate("shop-setup");
    } else {
      $("registerMessage").textContent =
        "Account created. Please confirm your email, then log in.";
    }
  } catch (error) {
    console.error(error);
    $("registerMessage").textContent =
      getAuthError(error);
  } finally {
    resetButton($("registerButton"), "Create Account");
  }
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessages();

  const email = $("loginEmail").value.trim().toLowerCase();
  const password = $("loginPassword").value;

  setLoading($("loginButton"), "Logging in...");

  try {
    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password
      });

    if (error) throw error;

    await renderApplication();
  } catch (error) {
    console.error(error);
    $("loginMessage").textContent =
      getAuthError(error);
  } finally {
    resetButton($("loginButton"), "Log In");
  }
});

async function googleAuth() {
  clearMessages();

  $("googleLoginButton").disabled = true;
  $("googleRegisterButton").disabled = true;

  try {
    const redirectTo =
      `${window.location.origin}${window.location.pathname}`;

    const { error } =
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo }
      });

    if (error) throw error;
  } catch (error) {
    const message =
      error?.message || "Unable to continue with Google.";

    if (getRoute() === "register") {
      $("registerMessage").textContent = message;
    } else {
      $("loginMessage").textContent = message;
    }

    $("googleLoginButton").disabled = false;
    $("googleRegisterButton").disabled = false;
  }
}

$("googleLoginButton").addEventListener("click", googleAuth);
$("googleRegisterButton").addEventListener("click", googleAuth);

// ============================================================
// SHOP
// ============================================================

$("shopSetupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessages();

  let user;

  try {
    user = await getCurrentUser();
  } catch (error) {
    $("shopSetupMessage").textContent =
      error?.message || "Your session is no longer available.";
    return;
  }

  const name = $("shopName").value.trim();
  const address = $("shopAddress").value.trim();
  const logoFile = $("shopLogo").files[0];

  if (name.length < 2) {
    $("shopSetupMessage").textContent =
      "Shop name must be at least 2 characters.";
    return;
  }

  if (!address) {
    $("shopSetupMessage").textContent =
      "Shop address is required.";
    return;
  }

  setLoading($("saveShopButton"), "Saving...");

  try {
    const seller = await getSeller(user.id);

    if (!seller) {
      throw new Error("Seller profile was not found.");
    }

    let logoPath = seller.shop_logo_path;

    if (logoFile) {
      validateLogo(logoFile);

      const ext = safeExtension(logoFile.name);
      const path =
        `${user.id}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } =
        await supabase.storage
          .from("shop-logos")
          .upload(path, logoFile, {
            contentType: logoFile.type,
            cacheControl: "3600",
            upsert: false
          });

      if (uploadError) throw uploadError;

      const oldLogo = logoPath;
      logoPath = path;

      if (oldLogo) {
        const { error: removeError } =
          await supabase.storage
            .from("shop-logos")
            .remove([oldLogo]);

        if (removeError) {
          console.warn("Old logo could not be removed:", removeError);
        }
      }
    }

    const { data, error } =
      await supabase
        .from("sellers")
        .update({
          shop_name: name,
          shop_address: address,
          shop_logo_path: logoPath,
          updated_at: new Date().toISOString()
        })
        .eq("id", user.id)
        .select()
        .single();

    if (error) throw error;
    if (!data) throw new Error("Shop profile was not updated.");

    await renderApplication();
  } catch (error) {
    console.error("Shop setup failed:", error);
    $("shopSetupMessage").textContent =
      error?.message || "Unable to save shop information.";
  } finally {
    resetButton($("saveShopButton"), "Save Shop");
  }
});

$("shopLogo").addEventListener("change", () => {
  const file = $("shopLogo").files[0];

  if (!file) {
    $("shopLogoPreviewContainer").hidden = true;
    $("shopLogoPreview").removeAttribute("src");
    return;
  }

  try {
    validateLogo(file);
    $("shopLogoPreview").src = URL.createObjectURL(file);
    $("shopLogoPreviewContainer").hidden = false;
    $("shopSetupMessage").textContent = "";
  } catch (error) {
    $("shopLogo").value = "";
    $("shopLogoPreviewContainer").hidden = true;
    $("shopSetupMessage").textContent = error.message;
  }
});

$("editShopButton").addEventListener("click", async () => {
  try {
    const user = await getCurrentUser();
    const seller = await getSeller(user.id);
    populateShopForm(seller);
    navigate("shop-setup");
  } catch (error) {
    console.error(error);
  }
});

$("homeLogoutButton").addEventListener("click", logout);
$("shopSetupLogoutButton").addEventListener("click", logout);

async function logout() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    navigate("login");
  } catch (error) {
    console.error(error);
    alert("Unable to log out. Please try again.");
  }
}

// ============================================================
// PRODUCTS
// ============================================================

$("productsButton").addEventListener("click", () => {
  navigate("products");
});

$("productsBackButton").addEventListener("click", () => {
  closeProductEditor();
  navigate("home");
});

$("addProductButton").addEventListener("click", () => {
  openProductEditor();
});

$("emptyAddProductButton").addEventListener("click", () => {
  openProductEditor();
});

$("cancelProductButton").addEventListener("click", () => {
  closeProductEditor();
});

$("productsLogoutButton").addEventListener("click", logout);

$("productForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveProduct();
});

async function loadProducts() {
  $("productList").innerHTML = "";
  $("emptyProductsState").hidden = true;
  $("productEditor").hidden = true;

  const user = await getCurrentUser();

  const { data, error } =
    await supabase
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

  if (!data.length) {
    $("emptyProductsState").hidden = false;
    return;
  }

  data.forEach(product => {
    $("productList").appendChild(
      createProductCard(product)
    );
  });
}

function createProductCard(product) {
  const card = document.createElement("article");
  card.className = "product-card";

  const info = document.createElement("div");
  info.className = "product-card-info";

  const title = document.createElement("h2");
  title.textContent = product.name;

  const price = document.createElement("p");
  price.className = "product-price";
  price.textContent = formatPrice(product.default_price);

  info.append(title, price);

  const actions = document.createElement("div");
  actions.className = "product-card-actions";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "secondary-button";
  editButton.textContent = "Edit";
  editButton.addEventListener(
    "click",
    () => openProductEditor(product)
  );

  actions.appendChild(editButton);
  card.append(info, actions);

  return card;
}

function openProductEditor(product = null) {
  $("productMessage").textContent = "";

  if (product) {
    editingProductId = product.id;
    $("productEditorTitle").textContent = "Edit Product";
    $("productName").value = product.name;
    $("productPrice").value =
      Number(product.default_price).toFixed(2);
  } else {
    editingProductId = null;
    $("productEditorTitle").textContent = "Add Product";
    $("productName").value = "";
    $("productPrice").value = "";
  }

  $("productEditor").hidden = false;
  $("productName").focus();
}

function closeProductEditor() {
  editingProductId = null;
  $("productEditor").hidden = true;
  $("productName").value = "";
  $("productPrice").value = "";
  $("productMessage").textContent = "";
}

async function saveProduct() {
  $("productMessage").textContent = "";

  const user = await getCurrentUser();
  const name = $("productName").value.trim();
  const price = Number($("productPrice").value);

  if (!name) {
    $("productMessage").textContent =
      "Product name is required.";
    return;
  }

  if (name.length > 150) {
    $("productMessage").textContent =
      "Product name must be 150 characters or fewer.";
    return;
  }

  if (!Number.isFinite(price) || price < 0) {
    $("productMessage").textContent =
      "Enter a valid non-negative price.";
    return;
  }

  setLoading($("saveProductButton"), "Saving...");

  try {
    if (editingProductId) {
      const { data, error } =
        await supabase
          .from("products")
          .update({
            name,
            default_price: price,
            updated_at: new Date().toISOString()
          })
          .eq("id", editingProductId)
          .eq("seller_id", user.id)
          .select()
          .single();

      if (error) throw error;
      if (!data) throw new Error("Product was not updated.");
    } else {
      const { data, error } =
        await supabase
          .from("products")
          .insert({
            seller_id: user.id,
            name,
            default_price: price
          })
          .select()
          .single();

      if (error) throw error;
      if (!data) throw new Error("Product was not created.");
    }

    closeProductEditor();
    await loadProducts();
  } catch (error) {
    console.error("Product save failed:", error);
    $("productMessage").textContent =
      error?.message || "Unable to save product.";
  } finally {
    resetButton($("saveProductButton"), "Save Product");
  }
}

// ============================================================
// HELPERS
// ============================================================

function populateShopForm(seller) {
  $("shopName").value = seller?.shop_name || "";
  $("shopAddress").value = seller?.shop_address || "";
  $("shopLogo").value = "";
  $("shopLogoPreviewContainer").hidden = true;
  $("shopLogoPreview").removeAttribute("src");
}

function validateLogo(file) {
  const allowed = ["image/png", "image/jpeg", "image/webp"];

  if (!allowed.includes(file.type)) {
    throw new Error("Shop logo must be PNG, JPEG, or WebP.");
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Shop logo must be 5 MB or smaller.");
  }
}

function safeExtension(fileName) {
  const ext = fileName.split(".").pop().toLowerCase();
  return ["png", "jpg", "jpeg", "webp"].includes(ext)
    ? ext
    : "jpg";
}

function setLoading(button, text) {
  button.disabled = true;
  button.textContent = text;
}

function resetButton(button, text) {
  button.disabled = false;
  button.textContent = text;
}

function clearMessages() {
  $("loginMessage").textContent = "";
  $("registerMessage").textContent = "";
  $("shopSetupMessage").textContent = "";
}

function getAuthError(error) {
  const message = String(error?.message || "");
  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "Invalid email or password.";
  }

  if (lower.includes("email not confirmed")) {
    return "Please confirm your email before logging in.";
  }

  return message || "Authentication failed.";
}

function formatPrice(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
  }).format(
    Number.isFinite(Number(value)) ? Number(value) : 0
  );
}

// ============================================================
// AUTH STATE + ROUTING
// ============================================================

supabase.auth.onAuthStateChange(
  (_event, currentSession) => {
    setTimeout(() => {
      if (currentSession) {
        renderApplication();
      } else {
        showScreen(
          getRoute() === "register"
            ? "register"
            : "login"
        );
      }
    }, 0);
  }
);

window.addEventListener(
  "hashchange",
  () => {
    renderApplication();
  }
);

renderApplication();
