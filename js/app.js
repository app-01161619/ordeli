import { supabase } from "./supabase.js";

const $ = (id) => document.getElementById(id);

let currentSession = null;
let editingProductId = null;
let workflowProductId = null;
let workflowStages = [];
let printSeriesId = null;
let scanner = null;
let scannerRunning = false;
let scannerHandlingResult = false;
let scannedQr = null;

const screens = {
  login: $("loginScreen"),
  register: $("registerScreen"),
  shopProfile: $("shopProfileScreen"),
  home: $("homeScreen"),
  scan: $("scanScreen"),
  orderEditor: $("orderEditorScreen"),
  orderDetail: $("orderDetailScreen"),
  orders: $("ordersScreen"),
  products: $("productsScreen"),
  workflow: $("workflowScreen"),
  qr: $("qrScreen"),
  qrPrint: $("qrPrintScreen")
};

function getRoute() {
  const route = window.location.hash.replace(/^#/, "").toLowerCase();
  const allowed = [
    "login", "register", "shop-profile", "home", "scan",
    "order-editor", "order-detail", "orders", "products",
    "workflow", "qr", "qr-print"
  ];
  return allowed.includes(route) ? route : "login";
}

function navigate(route) {
  window.location.hash = route;
}

function routeToScreenKey(route) {
  return {
    "shop-profile": "shopProfile",
    "order-editor": "orderEditor",
    "order-detail": "orderDetail",
    "qr-print": "qrPrint"
  }[route] || route;
}

function showScreen(route) {
  const key = routeToScreenKey(route);
  Object.entries(screens).forEach(([name, element]) => {
    if (element) element.hidden = name !== key;
  });
}

async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function loadSellerProfile(userId) {
  const { data, error } = await supabase
    .from("seller_profiles")
    .select("shop_name, shop_address, shop_logo_path")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

function isShopProfileComplete(profile) {
  return Boolean(profile?.shop_name?.trim() && profile?.shop_address?.trim());
}

async function renderApplication() {
  currentSession = await getSession();
  const route = getRoute();

  if (!currentSession) {
    await stopScanner();
    showScreen(route === "register" ? "register" : "login");
    return;
  }

  const profile = await loadSellerProfile(currentSession.user.id);

  if (!isShopProfileComplete(profile)) {
    populateShopProfile(profile);
    showScreen("shopProfile");
    return;
  }

  $("homeShopName").textContent = profile.shop_name;
  $("homeShopAddress").textContent = profile.shop_address;

  if (route === "scan") {
    showScreen("scan");
    await startScanner();
    return;
  }

  if (route === "order-editor") {
    if (!scannedQr) {
      navigate("scan");
      return;
    }
    showScreen("orderEditor");
    return;
  }

  if (route === "order-detail") {
    showScreen("orderDetail");
    return;
  }

  if (route === "orders") {
    showScreen("orders");
    await loadOrders();
    return;
  }

  if (route === "products") {
    showScreen("products");
    await loadProducts();
    return;
  }

  if (route === "workflow") {
    if (!workflowProductId) {
      navigate("products");
      return;
    }
    showScreen("workflow");
    await loadWorkflowStages();
    return;
  }

  if (route === "qr") {
    showScreen("qr");
    await loadQrManagement();
    return;
  }

  if (route === "qr-print") {
    if (!printSeriesId) {
      navigate("qr");
      return;
    }
    showScreen("qrPrint");
    await loadPrintableQrCards();
    return;
  }

  if (route === "shop-profile") {
    populateShopProfile(profile);
    showScreen("shopProfile");
    return;
  }

  showScreen("home");
}

// ============================================================
// AUTH
// ============================================================

$("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessages();

  const shopName = $("registerShopName").value.trim();
  const password = $("registerPassword").value;
  const confirmPassword = $("registerConfirmPassword").value;

  if (shopName.length < 2) {
    $("registerMessage").textContent = "Shop name must be at least 2 characters.";
    return;
  }
  if (password.length < 8) {
    $("registerMessage").textContent = "Password must be at least 8 characters.";
    return;
  }
  if (password !== confirmPassword) {
    $("registerMessage").textContent = "Passwords do not match.";
    return;
  }

  $("registerButton").disabled = true;
  $("registerButton").textContent = "Creating...";

  try {
    const internalEmail = `${crypto.randomUUID()}@internal.invalid`;
    const { data, error } = await supabase.auth.signUp({
      email: internalEmail,
      password,
      options: {
        data: {
          shop_name: shopName,
          login_identifier: internalEmail
        }
      }
    });
    if (error) throw error;
    if (!data.session) {
      throw new Error("Account was created but no session was returned. Check that email confirmation is disabled.");
    }
    navigate("shop-profile");
  } catch (error) {
    console.error("Registration failed:", error);
    $("registerMessage").textContent = error.message || "Unable to create account.";
  } finally {
    $("registerButton").disabled = false;
    $("registerButton").textContent = "Create Account";
  }
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessages();

  const shopName = $("loginShopName").value.trim();
  const password = $("loginPassword").value;

  $("loginButton").disabled = true;
  $("loginButton").textContent = "Logging in...";

  try {
    const { data, error } = await supabase.rpc("get_login_identifier", {
      requested_shop_name: shopName
    });
    if (error) throw error;
    if (!data) throw new Error("Invalid credentials.");

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: data,
      password
    });
    if (loginError) throw loginError;

    await renderApplication();
  } catch (error) {
    console.error("Login failed:", error);
    $("loginMessage").textContent = "Invalid shop name or password.";
  } finally {
    $("loginButton").disabled = false;
    $("loginButton").textContent = "Log In";
  }
});

// ============================================================
// SHOP PROFILE
// ============================================================

$("shopProfileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("shopProfileMessage").textContent = "";

  const session = await getSession();
  if (!session) {
    navigate("login");
    return;
  }

  const name = $("shopName").value.trim();
  const address = $("shopAddress").value.trim();
  const selectedLogo = $("shopLogo").files[0];

  if (name.length < 2) {
    $("shopProfileMessage").textContent = "Shop name must be at least 2 characters.";
    return;
  }
  if (!address) {
    $("shopProfileMessage").textContent = "Shop address is required.";
    return;
  }

  $("saveShopProfileButton").disabled = true;
  $("saveShopProfileButton").textContent = "Saving...";

  try {
    const existing = await loadSellerProfile(session.user.id);
    let logoPath = existing.shop_logo_path;

    if (selectedLogo) {
      const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
      if (!allowedTypes.includes(selectedLogo.type)) throw new Error("Please choose a PNG, JPEG, or WebP image.");
      if (selectedLogo.size > 5 * 1024 * 1024) throw new Error("Shop logo must be 5 MB or smaller.");

      const extension = getFileExtension(selectedLogo.name);
      const filePath = `${session.user.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("shop-logos").upload(filePath, selectedLogo, {
        contentType: selectedLogo.type,
        cacheControl: "3600",
        upsert: false
      });
      if (uploadError) throw uploadError;

      logoPath = filePath;
      if (existing.shop_logo_path) {
        await supabase.storage.from("shop-logos").remove([existing.shop_logo_path]);
      }
    }

    const { error } = await supabase
      .from("seller_profiles")
      .update({ shop_name: name, shop_address: address, shop_logo_path: logoPath })
      .eq("id", session.user.id);

    if (error) throw error;
    await renderApplication();
  } catch (error) {
    console.error("Shop profile save failed:", error);
    $("shopProfileMessage").textContent = error.message || "Unable to save shop profile.";
  } finally {
    $("saveShopProfileButton").disabled = false;
    $("saveShopProfileButton").textContent = "Save Shop Profile";
  }
});

$("shopLogo").addEventListener("change", () => {
  const file = $("shopLogo").files[0];
  if (!file) {
    $("shopLogoPreviewContainer").hidden = true;
    $("shopLogoPreview").removeAttribute("src");
    return;
  }
  $("shopLogoPreview").src = URL.createObjectURL(file);
  $("shopLogoPreviewContainer").hidden = false;
});

function populateShopProfile(profile) {
  $("shopName").value = profile?.shop_name || "";
  $("shopAddress").value = profile?.shop_address || "";
  $("shopLogo").value = "";
  $("shopLogoPreviewContainer").hidden = true;
}

// ============================================================
// QR SCANNER
// ============================================================

$("scanFab").addEventListener("click", async () => {
  scannerHandlingResult = false;
  navigate("scan");
});

$("scanBackButton").addEventListener("click", async () => {
  await stopScanner();
  navigate("home");
});

async function startScanner() {
  if (scannerRunning || scannerHandlingResult) return;

  if (typeof Html5Qrcode === "undefined") {
    $("scanMessage").textContent = "QR scanner is unavailable. Refresh the app and try again.";
    $("scanRestartButton").hidden = false;
    return;
  }

  $("scanMessage").textContent = "Point the camera at a product QR card.";
  $("scanRestartButton").hidden = true;

  if (scanner) {
    try { await scanner.clear(); } catch {}
  }

  scanner = new Html5Qrcode("qrReader");

  try {
    await scanner.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const size = Math.min(viewfinderWidth, viewfinderHeight, 280);
          return { width: size, height: size };
        },
        aspectRatio: 1
      },
      async (decodedText) => {
        if (scannerHandlingResult) return;
        scannerHandlingResult = true;
        await stopScanner();
        await handleScannedQr(decodedText);
      },
      () => {}
    );

    scannerRunning = true;
  } catch (error) {
    console.error("Scanner start failed:", error);
    scannerRunning = false;
    $("scanMessage").textContent = "Unable to start the camera. Allow camera access and make sure the app is using HTTPS.";
    $("scanRestartButton").hidden = false;
  }
}

async function stopScanner() {
  if (!scanner) {
    scannerRunning = false;
    return;
  }

  try {
    if (scannerRunning) await scanner.stop();
    await scanner.clear();
  } catch (error) {
    console.warn("Scanner stop warning:", error);
  } finally {
    scannerRunning = false;
    scanner = null;
  }
}

$("scanRestartButton").addEventListener("click", async () => {
  scannerHandlingResult = false;
  await startScanner();
});

async function handleScannedQr(decodedText) {
  try {
    const token = extractPublicToken(decodedText);
    if (!token) throw new Error("Invalid QR code.");

    const { data, error } = await supabase
      .from("qr_codes")
      .select("id, code, public_token, status, product_id, products(id, name, default_price)")
      .eq("public_token", token)
      .eq("seller_id", currentSession.user.id)
      .single();

    if (error) throw error;
    if (!data) throw new Error("QR code not found.");

    if (data.status === "available") {
      scannedQr = {
        id: data.id,
        code: data.code,
        publicToken: data.public_token,
        productId: data.product_id,
        productName: data.products?.name || "Product",
        defaultPrice: Number(data.products?.default_price || 0)
      };
      openScannedOrderEditor();
      return;
    }

    if (data.status === "assigned") {
      await openAssignedQrOrder(data.id);
      return;
    }

    $("scanMessage").textContent = `This QR code is ${data.status} and cannot be used for a new order.`;
    $("scanRestartButton").hidden = false;
    showScreen("scan");
  } catch (error) {
    console.error("QR handling failed:", error);
    $("scanMessage").textContent = "This QR code is invalid, unavailable, or does not belong to this shop.";
    $("scanRestartButton").hidden = false;
    showScreen("scan");
  }
}

function extractPublicToken(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const tIndex = parts.indexOf("t");
    if (tIndex >= 0 && parts[tIndex + 1]) return decodeURIComponent(parts[tIndex + 1]);
    const queryToken = url.searchParams.get("token");
    if (queryToken) return queryToken;
  } catch {
    // Treat non-URL QR contents as raw tokens.
  }
  return String(value || "").trim() || null;
}

// ============================================================
// SCANNED ORDER CREATION
// ============================================================

function openScannedOrderEditor() {
  if (!scannedQr) return;

  $("orderEditorProductName").textContent = scannedQr.productName;
  $("orderEditorQrCode").textContent = `QR: ${scannedQr.code}`;
  $("scannedUnitPrice").textContent = formatPrice(scannedQr.defaultPrice);
  $("scannedCustomerName").value = "";
  $("scannedCustomerPhone").value = "";
  $("scannedQuantity").value = "1";
  $("scannedDownpayment").value = "0";
  $("scannedOrderMessage").textContent = "";
  updateScannedOrderTotals();
  showScreen("orderEditor");
  navigate("order-editor");
}

function updateScannedOrderTotals() {
  if (!scannedQr) return;
  const quantity = Math.max(1, Number($("scannedQuantity").value) || 1);
  const downpayment = Math.max(0, Number($("scannedDownpayment").value) || 0);
  const total = roundMoney(quantity * scannedQr.defaultPrice);
  const remaining = Math.max(0, roundMoney(total - downpayment));
  $("scannedOrderTotal").textContent = formatPrice(total);
  $("scannedRemainingBalance").textContent = formatPrice(remaining);
}

$("scannedQuantity").addEventListener("input", updateScannedOrderTotals);
$("scannedDownpayment").addEventListener("input", updateScannedOrderTotals);

$("scannedOrderForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!scannedQr) return;

  const customerName = $("scannedCustomerName").value.trim();
  const phone = $("scannedCustomerPhone").value.trim();
  const quantity = Number($("scannedQuantity").value);
  const downpayment = Number($("scannedDownpayment").value);
  const orderTotal = roundMoney(quantity * scannedQr.defaultPrice);

  if (!customerName) {
    $("scannedOrderMessage").textContent = "Customer name is required.";
    return;
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    $("scannedOrderMessage").textContent = "Quantity must be greater than zero.";
    return;
  }
  if (!Number.isFinite(downpayment) || downpayment < 0) {
    $("scannedOrderMessage").textContent = "Enter a valid downpayment.";
    return;
  }
  if (downpayment > orderTotal) {
    $("scannedOrderMessage").textContent = "Downpayment cannot be greater than the order total.";
    return;
  }

  $("createScannedOrderButton").disabled = true;
  $("createScannedOrderButton").textContent = "Creating...";

  try {
    const { data, error } = await supabase.rpc("create_order_from_scanned_qr", {
      requested_qr_code_id: scannedQr.id,
      requested_customer_name: customerName,
      requested_customer_phone: phone,
      requested_quantity: quantity,
      requested_downpayment: downpayment
    });
    if (error) throw error;
    scannedQr = null;
    await openOrderDetail(data);
  } catch (error) {
    console.error("Scanned order creation failed:", error);
    $("scannedOrderMessage").textContent = error.message || "Unable to create order.";
  } finally {
    $("createScannedOrderButton").disabled = false;
    $("createScannedOrderButton").textContent = "Create Order";
  }
});

$("orderEditorBackButton").addEventListener("click", () => {
  scannedQr = null;
  navigate("scan");
});

// ============================================================
// ORDER DETAIL
// ============================================================

async function openAssignedQrOrder(qrCodeId) {
  try {
    const { data, error } = await supabase
      .from("order_items")
      .select("order_id")
      .eq("qr_code_id", qrCodeId)
      .eq("seller_id", currentSession.user.id)
      .single();
    if (error) throw error;
    await openOrderDetail(data.order_id);
  } catch (error) {
    console.error("Assigned QR lookup failed:", error);
    $("scanMessage").textContent = "Unable to find the order associated with this QR code.";
    $("scanRestartButton").hidden = false;
    showScreen("scan");
  }
}

async function openOrderDetail(orderId) {
  const { data, error } = await supabase
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
        id,
        product_name,
        quantity,
        unit_price,
        total_price,
        qr_code_id,
        order_item_production_stages (
          stage_name,
          stage_order
        )
      )
    `)
    .eq("id", orderId)
    .eq("seller_id", currentSession.user.id)
    .single();

  if (error) throw error;

  const { data: payments, error: paymentError } = await supabase
    .from("payments")
    .select("amount, status, payment_type, created_at")
    .eq("order_id", orderId)
    .eq("seller_id", currentSession.user.id)
    .order("created_at", { ascending: true });

  if (paymentError) throw paymentError;

  const paid = roundMoney(
    (payments || [])
      .filter((payment) => payment.status === "confirmed")
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  );
  const remaining = Math.max(0, roundMoney(Number(data.total_amount) - paid));

  $("orderDetailNumber").textContent = `Order #${data.order_number}`;
  $("orderDetailCustomer").textContent = data.customer_name;
  $("detailCustomerName").textContent = data.customer_name;
  $("detailCustomerPhone").textContent = data.customer_phone || "—";
  $("detailOrderStatus").textContent = data.status === "active" ? "Active" : "Cancelled";
  $("detailOrderTotal").textContent = formatPrice(data.total_amount);
  $("detailPaidAmount").textContent = formatPrice(paid);
  $("detailRemainingAmount").textContent = formatPrice(remaining);

  const container = $("orderDetailItems");
  container.innerHTML = "";

  for (const item of data.order_items || []) {
    const row = document.createElement("div");
    row.className = "detail-item-card";

    const name = document.createElement("strong");
    name.textContent = `${item.product_name} × ${item.quantity}`;

    const total = document.createElement("span");
    total.textContent = formatPrice(item.total_price);

    row.append(name, total);
    container.appendChild(row);
  }

  $("orderDetailMessage").textContent = "";
  showScreen("orderDetail");
  navigate("order-detail");
}

$("orderDetailBackButton").addEventListener("click", () => navigate("home"));

// ============================================================
// ORDERS LIST
// ============================================================

async function loadOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select(`
      id,
      order_number,
      customer_name,
      customer_phone,
      total_amount,
      status,
      created_at,
      order_items(product_name, quantity)
    `)
    .eq("seller_id", currentSession.user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;

  $("orderList").innerHTML = "";
  $("emptyOrdersState").hidden = Boolean(data.length);

  data.forEach((order) => {
    const card = document.createElement("article");
    card.className = "order-card";
    card.tabIndex = 0;

    const header = document.createElement("div");
    header.className = "order-card-header";

    const number = document.createElement("strong");
    number.textContent = `Order #${order.order_number}`;

    const customer = document.createElement("span");
    customer.textContent = order.customer_name;

    header.append(number, customer);

    const items = document.createElement("div");
    items.className = "order-card-items";
    (order.order_items || []).forEach((item) => {
      const row = document.createElement("div");
      row.textContent = `${item.product_name} × ${item.quantity}`;
      items.appendChild(row);
    });

    const total = document.createElement("strong");
    total.className = "order-card-total";
    total.textContent = formatPrice(order.total_amount);

    card.append(header, items, total);
    card.addEventListener("click", () => openOrderDetail(order.id));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") openOrderDetail(order.id);
    });
    $("orderList").appendChild(card);
  });
}

$("ordersButton").addEventListener("click", () => navigate("orders"));
$("productsButton").addEventListener("click", () => navigate("products"));
$("qrManagementButton").addEventListener("click", () => navigate("qr"));
$("qrManagementButtonFromProducts").addEventListener("click", () => navigate("qr"));
$("ordersBackButton").addEventListener("click", () => navigate("home"));

// ============================================================
// PRODUCTS
// ============================================================

async function loadProducts() {
  $("productList").innerHTML = "";
  $("emptyProductsState").hidden = true;
  $("productEditor").hidden = true;

  const { data, error } = await supabase
    .from("products")
    .select("id, name, default_price, created_at, updated_at")
    .eq("seller_id", currentSession.user.id)
    .order("name", { ascending: true });

  if (error) throw error;

  if (!data.length) {
    $("emptyProductsState").hidden = false;
    return;
  }

  data.forEach((product) => $("productList").appendChild(createProductCard(product)));
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

  const workflowButton = document.createElement("button");
  workflowButton.type = "button";
  workflowButton.textContent = "Workflow";
  workflowButton.addEventListener("click", () => openWorkflow(product));

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "secondary-button";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", () => openProductEditor(product));

  actions.append(workflowButton, editButton);
  card.append(info, actions);
  return card;
}

function openProductEditor(product = null) {
  clearProductMessage();
  editingProductId = product?.id || null;
  $("productEditorTitle").textContent = product ? "Edit Product" : "Add Product";
  $("productName").value = product?.name || "";
  $("productPrice").value = product ? Number(product.default_price).toFixed(2) : "";
  $("productEditor").hidden = false;
  $("productName").focus();
}

function closeProductEditor() {
  editingProductId = null;
  $("productEditor").hidden = true;
  $("productName").value = "";
  $("productPrice").value = "";
  clearProductMessage();
}

$("addProductButton").addEventListener("click", () => openProductEditor());
$("emptyAddProductButton").addEventListener("click", () => openProductEditor());
$("cancelProductButton").addEventListener("click", closeProductEditor);

$("productForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearProductMessage();

  const name = $("productName").value.trim();
  const price = Number($("productPrice").value);

  if (!name) {
    $("productMessage").textContent = "Product name is required.";
    return;
  }
  if (!Number.isFinite(price) || price < 0) {
    $("productMessage").textContent = "Enter a valid price.";
    return;
  }

  $("saveProductButton").disabled = true;
  $("saveProductButton").textContent = "Saving...";

  try {
    if (editingProductId) {
      const { error } = await supabase
        .from("products")
        .update({ name, default_price: price, updated_at: new Date().toISOString() })
        .eq("id", editingProductId)
        .eq("seller_id", currentSession.user.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("products")
        .insert({ seller_id: currentSession.user.id, name, default_price: price });
      if (error) throw error;
    }
    closeProductEditor();
    await loadProducts();
  } catch (error) {
    console.error(error);
    $("productMessage").textContent = error.message || "Unable to save product.";
  } finally {
    $("saveProductButton").disabled = false;
    $("saveProductButton").textContent = "Save Product";
  }
});

$("productsBackButton").addEventListener("click", () => {
  closeProductEditor();
  navigate("home");
});

// ============================================================
// WORKFLOW
// ============================================================

async function openWorkflow(product) {
  workflowProductId = product.id;
  $("workflowProductName").textContent = product.name;
  clearWorkflowMessage();
  navigate("workflow");
}

async function loadWorkflowStages() {
  $("stageList").innerHTML = "";
  $("emptyStagesState").hidden = true;

  const { data, error } = await supabase
    .from("production_stages")
    .select("id, name, stage_order")
    .eq("product_id", workflowProductId)
    .order("stage_order", { ascending: true });

  if (error) throw error;

  workflowStages = data.map((stage) => ({ id: stage.id, name: stage.name, stage_order: stage.stage_order }));
  renderWorkflowStages();
}

function renderWorkflowStages() {
  $("stageList").innerHTML = "";

  if (!workflowStages.length) {
    $("emptyStagesState").hidden = false;
    return;
  }

  $("emptyStagesState").hidden = true;
  workflowStages.forEach((stage, index) => {
    stage.stage_order = index + 1;
    $("stageList").appendChild(createStageElement(stage, index));
  });
}

function createStageElement(stage, index) {
  const item = document.createElement("div");
  item.className = "stage-item";

  const number = document.createElement("div");
  number.className = "stage-number";
  number.textContent = String(index + 1);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "stage-name-input";
  input.maxLength = 100;
  input.value = stage.name;
  input.placeholder = "Stage name";
  input.addEventListener("input", () => { stage.name = input.value; });

  const actions = document.createElement("div");
  actions.className = "stage-actions";

  const up = document.createElement("button");
  up.type = "button";
  up.className = "secondary-button stage-action-button";
  up.textContent = "↑";
  up.disabled = index === 0;
  up.addEventListener("click", () => moveStage(index, -1));

  const down = document.createElement("button");
  down.type = "button";
  down.className = "secondary-button stage-action-button";
  down.textContent = "↓";
  down.disabled = index === workflowStages.length - 1;
  down.addEventListener("click", () => moveStage(index, 1));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger-button stage-action-button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => removeStage(index));

  actions.append(up, down, remove);
  item.append(number, input, actions);
  return item;
}

function moveStage(index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= workflowStages.length) return;
  [workflowStages[index], workflowStages[newIndex]] = [workflowStages[newIndex], workflowStages[index]];
  renderWorkflowStages();
}

function removeStage(index) {
  workflowStages.splice(index, 1);
  renderWorkflowStages();
}

function addStage() {
  workflowStages.push({ id: null, name: "", stage_order: workflowStages.length + 1 });
  renderWorkflowStages();
  const inputs = document.querySelectorAll(".stage-name-input");
  inputs[inputs.length - 1]?.focus();
}

$("addStageButton").addEventListener("click", addStage);
$("emptyAddStageButton").addEventListener("click", addStage);

$("saveWorkflowButton").addEventListener("click", async () => {
  clearWorkflowMessage();
  const stages = workflowStages.map((stage) => ({ name: stage.name.trim() }));

  if (!stages.length) {
    $("workflowMessage").textContent = "Add at least one production stage.";
    return;
  }
  if (stages.some((stage) => !stage.name)) {
    $("workflowMessage").textContent = "Every production stage needs a name.";
    return;
  }

  $("saveWorkflowButton").disabled = true;
  $("saveWorkflowButton").textContent = "Saving...";

  try {
    const { error: deleteError } = await supabase
      .from("production_stages")
      .delete()
      .eq("product_id", workflowProductId);
    if (deleteError) throw deleteError;

    const rows = stages.map((stage, index) => ({ product_id: workflowProductId, name: stage.name, stage_order: index + 1 }));
    const { error: insertError } = await supabase
      .from("production_stages")
      .insert(rows);
    if (insertError) throw insertError;

    $("workflowMessage").textContent = "Production workflow saved.";
    $("workflowMessage").classList.add("success-message");
    await loadWorkflowStages();
  } catch (error) {
    console.error(error);
    $("workflowMessage").textContent = error.message || "Unable to save production workflow.";
  } finally {
    $("saveWorkflowButton").disabled = false;
    $("saveWorkflowButton").textContent = "Save Workflow";
  }
});

$("workflowBackButton").addEventListener("click", () => {
  workflowProductId = null;
  workflowStages = [];
  navigate("products");
});

$("cancelWorkflowButton").addEventListener("click", () => {
  workflowProductId = null;
  workflowStages = [];
  navigate("products");
});

// ============================================================
// QR MANAGEMENT
// ============================================================

async function loadQrManagement() {
  clearQrMessage();
  await loadQrProducts();
  await loadQrSeries();
}

async function loadQrProducts() {
  $("qrProduct").innerHTML = `<option value="">Select product</option>`;

  const { data, error } = await supabase
    .from("products")
    .select("id, name")
    .eq("seller_id", currentSession.user.id)
    .order("name", { ascending: true });

  if (error) throw error;

  data.forEach((product) => {
    const option = document.createElement("option");
    option.value = product.id;
    option.textContent = product.name;
    $("qrProduct").appendChild(option);
  });
}

async function loadQrSeries() {
  $("qrSeriesList").innerHTML = "";
  $("emptyQrState").hidden = true;

  const { data, error } = await supabase
    .from("qr_series")
    .select("id, series_name, quantity, created_at, products(name), qr_codes(status)")
    .eq("seller_id", currentSession.user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;

  if (!data.length) {
    $("emptyQrState").hidden = false;
    return;
  }

  data.forEach((series) => $("qrSeriesList").appendChild(createQrSeriesCard(series)));
}

function createQrSeriesCard(series) {
  const card = document.createElement("article");
  card.className = "qr-series-card";

  const title = document.createElement("h3");
  title.textContent = series.series_name;

  const product = document.createElement("p");
  product.textContent = `Product: ${series.products?.name || "Unknown"}`;

  const total = document.createElement("p");
  total.textContent = `Total pairs: ${series.quantity}`;

  const counts = { available: 0, assigned: 0, released: 0, revoked: 0 };
  (series.qr_codes || []).forEach((qr) => {
    if (counts[qr.status] !== undefined) counts[qr.status]++;
  });

  const status = document.createElement("p");
  status.className = "qr-series-status";
  status.textContent = `Available: ${counts.available} · Assigned: ${counts.assigned} · Released: ${counts.released} · Revoked: ${counts.revoked}`;

  const print = document.createElement("button");
  print.type = "button";
  print.className = "secondary-button qr-print-button";
  print.textContent = `Print Available Cards (${counts.available})`;
  print.disabled = counts.available === 0;
  print.addEventListener("click", () => openQrPrintScreen(series));

  card.append(title, product, total, status, print);
  return card;
}

$("qrSeriesForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearQrMessage();

  const productId = $("qrProduct").value;
  const seriesName = $("qrSeriesName").value.trim();
  const quantity = Number($("qrQuantity").value);

  if (!productId) { $("qrMessage").textContent = "Select a product."; return; }
  if (!seriesName) { $("qrMessage").textContent = "Enter a series name."; return; }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5000) {
    $("qrMessage").textContent = "Enter a quantity between 1 and 5000.";
    return;
  }

  $("generateQrButton").disabled = true;
  $("generateQrButton").textContent = "Generating...";

  try {
    const { error } = await supabase.rpc("create_qr_series", {
      requested_product_id: productId,
      requested_series_name: seriesName,
      requested_quantity: quantity
    });
    if (error) throw error;

    $("qrSeriesForm").reset();
    $("qrMessage").textContent = "QR series generated successfully.";
    $("qrMessage").classList.add("success-message");
    await loadQrSeries();
  } catch (error) {
    console.error(error);
    $("qrMessage").textContent = error.message || "Unable to generate QR series.";
  } finally {
    $("generateQrButton").disabled = false;
    $("generateQrButton").textContent = "Generate QR Series";
  }
});

$("qrBackButton").addEventListener("click", () => navigate("home"));

// ============================================================
// QR PRINTING
// ============================================================

async function openQrPrintScreen(series) {
  printSeriesId = series.id;
  $("printSeriesName").textContent = series.series_name;
  $("printCardGrid").innerHTML = "";
  navigate("qr-print");
}

async function loadPrintableQrCards() {
  $("printCardGrid").innerHTML = "";

  const shopProfile = await loadSellerProfile(currentSession.user.id);
  const { data: series, error: seriesError } = await supabase
    .from("qr_series")
    .select("id, series_name, quantity, products(name)")
    .eq("id", printSeriesId)
    .eq("seller_id", currentSession.user.id)
    .single();
  if (seriesError) throw seriesError;

  const { data: qrCodes, error: qrError } = await supabase
    .from("qr_codes")
    .select("id, code, public_token, status, created_at")
    .eq("series_id", printSeriesId)
    .eq("seller_id", currentSession.user.id)
    .eq("status", "available")
    .order("created_at", { ascending: true });
  if (qrError) throw qrError;

  const productName = series.products?.name || "Product";
  $("printSeriesInfo").textContent = `${shopProfile.shop_name} · ${productName} · ${qrCodes.length} available pairs`;

  if (!qrCodes.length) {
    $("printCardGrid").innerHTML = `<div class="empty-state"><h3>No Available QR Cards</h3><p>There are no available QR cards left in this series to print.</p></div>`;
    return;
  }

  const trackingBase = `${window.location.origin}/t/`;
  for (const qr of qrCodes) {
    const pair = document.createElement("div");
    pair.className = "qr-print-pair";
    const trackingUrl = `${trackingBase}${qr.public_token}`;

    pair.append(
      await createPrintableQrCard({
        copyType: "SELLER COPY",
        shopName: shopProfile.shop_name,
        productName,
        trackingUrl,
        qrCode: qr.code
      }),
      await createPrintableQrCard({
        copyType: "CUSTOMER COPY",
        shopName: shopProfile.shop_name,
        productName,
        trackingUrl,
        qrCode: qr.code
      })
    );

    $("printCardGrid").appendChild(pair);
  }
}

async function createPrintableQrCard({ copyType, shopName, productName, trackingUrl, qrCode }) {
  const card = document.createElement("article");
  card.className = "print-card";

  const header = document.createElement("div");
  header.className = "print-card-header";

  const shop = document.createElement("div");
  shop.className = "print-card-shop";
  shop.textContent = shopName;

  const copy = document.createElement("div");
  copy.className = "print-card-copy";
  copy.textContent = copyType;

  header.append(shop, copy);

  const product = document.createElement("div");
  product.className = "print-card-product";
  product.textContent = productName;

  const qrContainer = document.createElement("div");
  qrContainer.className = "print-card-qr";

  const canvas = document.createElement("canvas");
  canvas.width = 420;
  canvas.height = 420;
  qrContainer.appendChild(canvas);

  const instruction = document.createElement("div");
  instruction.className = "print-card-instruction";
  instruction.textContent = "Scan to track your order";

  const url = document.createElement("div");
  url.className = "print-card-url";
  url.textContent = trackingUrl;

  const code = document.createElement("div");
  code.className = "print-card-code";
  code.textContent = qrCode;

  card.append(header, product, qrContainer, instruction, url);
  if (copyType === "SELLER COPY") card.appendChild(code);

  await renderQrCode(canvas, trackingUrl);
  fitProductName(product);
  return card;
}

function renderQrCode(canvas, value) {
  return new Promise((resolve, reject) => {
    try {
      if (typeof QRCode === "undefined") throw new Error("QR code library is not loaded.");
      const qr = QRCode.QRCodeBrowser(canvas);
      qr.setOptions({ text: value, size: 420, qr: { correctLevel: 2 } });
      qr.draw();
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function fitProductName(element) {
  let fontSize = 13;
  element.style.fontSize = `${fontSize}pt`;
  while (element.scrollWidth > element.clientWidth && fontSize > 5) {
    fontSize -= 0.5;
    element.style.fontSize = `${fontSize}pt`;
  }
}

$("printCardsButton").addEventListener("click", () => {
  if ($("printCardGrid").children.length) window.print();
});

$("closePrintButton").addEventListener("click", () => {
  printSeriesId = null;
  $("printCardGrid").innerHTML = "";
  navigate("qr");
});

// ============================================================
// COMMON NAVIGATION / LOGOUT
// ============================================================

$("editShopProfileButton").addEventListener("click", () => navigate("shop-profile"));

async function logout() {
  try {
    await stopScanner();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    currentSession = null;
    scannedQr = null;
    navigate("login");
  } catch (error) {
    console.error(error);
    alert("Unable to log out. Please try again.");
  }
}

$("logoutButton").addEventListener("click", logout);
$("shopProfileLogoutButton").addEventListener("click", logout);
$("productsLogoutButton").addEventListener("click", logout);

// ============================================================
// HELPERS
// ============================================================

function clearMessages() {
  $("loginMessage").textContent = "";
  $("registerMessage").textContent = "";
  $("shopProfileMessage").textContent = "";
}

function clearProductMessage() {
  $("productMessage").textContent = "";
}

function clearWorkflowMessage() {
  $("workflowMessage").textContent = "";
  $("workflowMessage").classList.remove("success-message");
}

function clearQrMessage() {
  $("qrMessage").textContent = "";
  $("qrMessage").classList.remove("success-message");
}

function formatPrice(value) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number.isFinite(Number(value)) ? Number(value) : 0);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function getFileExtension(fileName) {
  const parts = fileName.split(".");
  return parts.length < 2 ? "jpg" : parts.pop().toLowerCase();
}

// ============================================================
// ROUTING + AUTH STATE
// ============================================================

window.addEventListener("hashchange", async () => {
  try {
    await renderApplication();
  } catch (error) {
    console.error("Navigation failed:", error);
  }
});

supabase.auth.onAuthStateChange(async (_event, session) => {
  currentSession = session;
  try {
    if (!session) {
      await stopScanner();
      showScreen("login");
      return;
    }
    await renderApplication();
  } catch (error) {
    console.error("Auth state error:", error);
  }
});

initializeApp();

async function initializeApp() {
  try {
    await renderApplication();
  } catch (error) {
    console.error("Application initialization failed:", error);
  }
}
