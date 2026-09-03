import { supabase, isSupabaseReady, readPersistedSession } from "./supabase.js";


// ============================================================
// HELPERS
// ============================================================

const $ = (id) =>
  document.getElementById(id);

// ============================================================
// OFFLINE / SYNC FOUNDATION
// ============================================================
const OFFLINE_DB_NAME = "ordeli-offline";
const OFFLINE_DB_VERSION = 3;
const OFFLINE_QUEUE_STORE = "sync_queue";
const OFFLINE_QR_STORE = "offline_qr_cache";
const OFFLINE_DEVICE_KEY = "ordeli-device-id";
const OFFLINE_CACHE_STORE = "entity_cache";
let offlineDbPromise = null;
let offlineSyncInProgress = false;
const LOCAL_FIRST = true;

async function runInBackground(task) {
  try { await task(); } catch (error) { console.warn("Background offline refresh failed:", error); }
}

async function cacheLocalOrderBundle(clientOrderId, payload) {
  const now = new Date().toISOString();
  const customerId = payload.customerId || `local-customer-${clientOrderId}`;
  const localOrder = { id: clientOrderId, order_number: `LOCAL-${clientOrderId.slice(0, 8).toUpperCase()}`, customer_id: customerId, created_at: now, cancelled_at: null, fulfillment_type: "not_selected", pickup_status: "not_scheduled", customers: { id: customerId, name: payload.customerName || "Customer", phone: payload.customerPhone || null }, offline: true, sync_status: "waiting", client_order_id: clientOrderId };
  const workflow = await getCachedSnapshot(`workflow-stages:${payload.productId || ""}`);
  const item = { id: `local-item-${clientOrderId}`, product_name: payload.productName || "Product", quantity: Number(payload.quantity)||1, unit_price: Number(payload.unitPrice)||0, total_price: Number(payload.total)||0, workflow_snapshot: Array.isArray(workflow) ? workflow.map(s=>({stage_order:s.stage_order,name:s.name})) : [], cancellable_until_stage:null, cancelled_at:null, offline:true };
  const payments = Number(payload.downpayment||0)>0 ? [{id:`local-payment-${clientOrderId}`,amount:Number(payload.downpayment)||0,payment_type:"downpayment",proof_status:null,created_at:now,offline:true}] : [];
  await cacheNamed(`order:${clientOrderId}`, localOrder); await cacheNamed(`order-items:${clientOrderId}`, [item]); await cacheNamed(`order-payments:${clientOrderId}`, payments); await cacheNamed(`order-payments-full:${clientOrderId}`, payments);
}

async function resolveOrderId(orderId) { const map = await getCachedSnapshot(`order-map:${orderId}`); return map?.serverOrderId || orderId; }
function getOfflineDeviceId() {
  let id = localStorage.getItem(OFFLINE_DEVICE_KEY);
  if (!id) {
    id = (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    localStorage.setItem(OFFLINE_DEVICE_KEY, id);
  }
  return id;
}
function openOfflineDb() {
  if (offlineDbPromise) return offlineDbPromise;
  offlineDbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { resolve(null); return; }
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        const store = db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("clientOrderId", "clientOrderId", { unique: false });
      }
      if (!db.objectStoreNames.contains(OFFLINE_QR_STORE)) {
        const qrStore = db.createObjectStore(OFFLINE_QR_STORE, { keyPath: "public_token" });
        qrStore.createIndex("used", "used", { unique: false });
        qrStore.createIndex("seriesKey", "seriesKey", { unique: false });
      }
      if (!db.objectStoreNames.contains(OFFLINE_CACHE_STORE)) {
        db.createObjectStore(OFFLINE_CACHE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open offline storage."));
  });
  return offlineDbPromise;
}
async function cacheSnapshot(key, value) {
  const db = await openOfflineDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_CACHE_STORE, "readwrite");
    tx.objectStore(OFFLINE_CACHE_STORE).put({ key, value, cachedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("Unable to cache offline data."));
  });
}

async function getCachedSnapshot(key) {
  const db = await openOfflineDb();
  if (!db) return null;
  return new Promise(resolve => {
    const request = db.transaction(OFFLINE_CACHE_STORE, "readonly").objectStore(OFFLINE_CACHE_STORE).get(key);
    request.onsuccess = () => resolve(request.result?.value ?? null);
    request.onerror = () => resolve(null);
  });
}

async function cacheNamed(key, value) {
  try { await cacheSnapshot(key, value); } catch (error) { console.warn("Offline cache write failed:", key, error); }
}

async function getPendingSyncCount() {
  const db = await openOfflineDb();
  if (!db) return 0;
  return new Promise(resolve => {
    const request = db.transaction(OFFLINE_QUEUE_STORE, "readonly").objectStore(OFFLINE_QUEUE_STORE).getAll();
    request.onsuccess = () => resolve((request.result || []).filter(row => ["waiting","syncing","error"].includes(row.status)).length);
    request.onerror = () => resolve(0);
  });
}


async function putOfflineQrRecords(records) {
  const db = await openOfflineDb();
  if (!db || !records?.length) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QR_STORE, "readwrite");
    const store = tx.objectStore(OFFLINE_QR_STORE);
    records.forEach(record => store.put(record));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("Unable to cache offline QR inventory."));
  });
}

async function getOfflineQr(publicToken) {
  const db = await openOfflineDb();
  if (!db) return null;
  return new Promise(resolve => {
    const request = db.transaction(OFFLINE_QR_STORE, "readonly").objectStore(OFFLINE_QR_STORE).get(publicToken);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}

async function markOfflineQrUsed(publicToken, clientOrderId) {
  const record = await getOfflineQr(publicToken);
  if (!record) return;
  record.used = true;
  record.usedByClientOrderId = clientOrderId;
  record.usedAt = new Date().toISOString();
  await putOfflineQrRecords([record]);
}

async function refreshOfflineQrCache() {
  if (!navigator.onLine) return;
  try {
    const user = await getCurrentUser();
    const deviceId = getOfflineDeviceId();
    const { data, error } = await supabase
      .from("offline_qr_reservations")
      .select("qr_code_id,device_id,qr_codes(id,product_id,series_name,series_sequence,code,public_token,status,products(id,name,default_price))")
      .eq("seller_id", user.id)
      .eq("device_id", deviceId);
    if (error) throw error;
    const records = (data || []).map(row => ({
      public_token: row.qr_codes?.public_token,
      qr_code_id: row.qr_codes?.id,
      product_id: row.qr_codes?.product_id,
      series_name: row.qr_codes?.series_name,
      series_sequence: row.qr_codes?.series_sequence,
      code: row.qr_codes?.code,
      status: row.qr_codes?.status,
      product: row.qr_codes?.products || null,
      device_id: deviceId,
      used: false,
      seriesKey: `${row.qr_codes?.product_id}::${row.qr_codes?.series_name}`,
      cachedAt: Date.now()
    })).filter(record => record.public_token);
    if (records.length) await putOfflineQrRecords(records);
  } catch (error) {
    console.warn("Offline QR cache refresh failed:", error);
  }
}

async function enqueueOfflineOrder(payload) {
  const db = await openOfflineDb();
  if (!db) throw new Error("Offline storage is not available on this device.");
  const clientOrderId = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const row = {
    type: "create_order",
    status: "waiting",
    clientOrderId,
    deviceId: getOfflineDeviceId(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    payload
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, "readwrite");
    tx.objectStore(OFFLINE_QUEUE_STORE).add(row);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("Unable to save the order offline."));
  });
  return row;
}

async function getQueuedOrders() {
  const db = await openOfflineDb();
  if (!db) return [];
  return new Promise(resolve => {
    const request = db.transaction(OFFLINE_QUEUE_STORE, "readonly").objectStore(OFFLINE_QUEUE_STORE).getAll();
    request.onsuccess = () => resolve((request.result || []).filter(row => row.type === "create_order" && ["waiting","error","syncing"].includes(row.status)));
    request.onerror = () => resolve([]);
  });
}

async function updateQueuedOrder(row) {
  const db = await openOfflineDb();
  if (!db || !row?.id) return;
  await new Promise(resolve => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, "readwrite");
    tx.objectStore(OFFLINE_QUEUE_STORE).put(row);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

async function syncOfflineOrders() {
  if (!navigator.onLine || offlineSyncInProgress) return;
  const session = await supabase.auth.getSession();
  if (!session?.data?.session) return;
  offlineSyncInProgress = true;
  try {
    const queue = await getQueuedOrders();
    for (const row of queue) {
      row.status = "syncing";
      row.attempts = Number(row.attempts || 0) + 1;
      await updateQueuedOrder(row);
      await updateConnectivityIndicator();
      try {
        const p = row.payload;
        const { data, error } = await supabase.rpc("sync_offline_order", {
          p_client_order_id: row.clientOrderId,
          p_device_id: row.deviceId,
          p_qr_public_token: p.qrToken,
          p_customer_id: p.customerId || null,
          p_customer_name: p.customerName || null,
          p_customer_phone: p.customerPhone || null,
          p_quantity: p.quantity,
          p_downpayment: p.downpayment
        });
        if (error) throw error;
        row.status = "synced";
        row.syncedAt = new Date().toISOString();
        row.serverResult = data;
        if (data?.order_id) {
          await cacheNamed(`order-map:${row.clientOrderId}`, { serverOrderId: data.order_id, syncedAt: row.syncedAt });
          await cacheNamed(`order:${row.clientOrderId}`, { ...(await getCachedSnapshot(`order:${row.clientOrderId}`) || {}), sync_status: "synced", server_order_id: data.order_id });
        }
        await updateQueuedOrder(row);
      } catch (error) {
        row.status = "error";
        row.lastError = error?.message || "Synchronization failed.";
        row.lastErrorAt = new Date().toISOString();
        await updateQueuedOrder(row);
        console.error("Offline order sync failed:", error);
      }
    }
  } finally {
    offlineSyncInProgress = false;
    await updateConnectivityIndicator();
  }
}
function ensureConnectivityIndicator() {
  let indicator = $("connectivityIndicator");
  if (indicator) return indicator;
  indicator = document.createElement("div");
  indicator.id = "connectivityIndicator";
  indicator.className = "connectivity-indicator";
  indicator.setAttribute("role", "status");
  indicator.setAttribute("aria-live", "polite");
  document.body.appendChild(indicator);
  return indicator;
}
async function updateConnectivityIndicator() {
  const indicator = ensureConnectivityIndicator();
  const online = navigator.onLine;
  const pending = await getPendingSyncCount();
  indicator.classList.toggle("is-offline", !online);
  indicator.classList.toggle("is-online", online && pending === 0);
  indicator.classList.toggle("has-pending", pending > 0);
  indicator.textContent = !online ? (pending ? `Offline · ${pending} waiting to sync` : "Offline") : (pending ? `Waiting to Sync · ${pending}` : "Online");
}
function initializeOfflineFoundation() {
  ensureConnectivityIndicator();
  updateConnectivityIndicator();
  window.addEventListener("online", async () => {
    await updateConnectivityIndicator();
    await refreshOfflineQrCache();
    await syncOfflineOrders();
  });
  window.addEventListener("offline", updateConnectivityIndicator);
  window.setInterval(updateConnectivityIndicator, 5000);
  refreshOfflineQrCache();
  if (navigator.onLine) { runInBackground(warmOfflineCache); runInBackground(syncOfflineOrders); }
}


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

let productionBusyItemId = null;
let orderSaveBusy = false;
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


// ============================================================
// AUTH
// ============================================================

async function getSession() {
  const persisted = readPersistedSession();
  if (persisted?.user) return persisted;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}


async function getCurrentUser() {
  const session = await getSession();
  if (session?.user) return session.user;
  throw new Error("No authenticated user.");
}


// ============================================================
// SELLER
// ============================================================

async function getSeller(userId) {
  const cacheKey=`seller:${userId}`; const cached=await getCachedSnapshot(cacheKey);
  const fetcher=async()=>{const {data,error}=await supabase.from("sellers").select(`id, email, login_method, google_id, shop_name, shop_address, shop_logo_path`).eq("id",userId).maybeSingle(); if(error) throw error; return data;};
  if(cached){ if(navigator.onLine) runInBackground(async()=>{const fresh=await fetcher(); await cacheNamed(cacheKey,fresh); if(getRoute()==="home"&&fresh) await renderHome(fresh);}); return cached; }
  if(!navigator.onLine) return null; const fresh=await fetcher(); await cacheNamed(cacheKey,fresh); return fresh;
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


    if (getRoute() === "order-create") {
      restorePendingQr();
      showScreen("orderCreate");
      if (pendingQrToken && pendingProduct) { $("orderDetectedProduct").textContent=pendingProduct.name||"Product"; $("orderDetectedPrice").textContent=formatPrice(pendingProduct.default_price); updateOrderCreateTotals(); loadActiveCustomers(); }
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


$("shopSetupLogoutButton")
  .addEventListener(
    "click",
    logout
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
  const list=$("productList"); list.replaceChildren(); $("emptyProductsState").hidden=true; $("productEditor").hidden=true; const user=await getCurrentUser(); const key=`products:${user.id}`;
  const render=(data)=>{ if(getRoute()!=="products")return; list.replaceChildren(); if(!data?.length){$("emptyProductsState").hidden=false; return;} const f=document.createDocumentFragment(); data.forEach(p=>f.appendChild(createProductCard(p))); list.appendChild(f); };
  const cached=await getCachedSnapshot(key); if(cached!=null){ render(cached); if(navigator.onLine) runInBackground(async()=>{const r=await supabase.from("products").select(`id,seller_id,name,default_price,customer_cancellable_until_stage,is_active,created_at,updated_at`).eq("seller_id",user.id).eq("is_active",true).order("name",{ascending:true}); if(!r.error){await cacheNamed(key,r.data||[]); render(r.data||[]);}}); return;}
  if(!navigator.onLine){render([]); return;} const r=await supabase.from("products").select(`id,seller_id,name,default_price,customer_cancellable_until_stage,is_active,created_at,updated_at`).eq("seller_id",user.id).eq("is_active",true).order("name",{ascending:true}); if(r.error)throw r.error; await cacheNamed(key,r.data||[]); render(r.data||[]);
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


$("homeLogoutButton")
  .addEventListener(
    "click",
    logout
  );


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
  $("stageList").innerHTML=""; $("emptyStagesState").hidden=true; const user=await getCurrentUser(); const pk=`workflow-product:${workflowProductId}`, sk=`workflow-stages:${workflowProductId}`;
  const cachedProduct=await getCachedSnapshot(pk), cachedStages=await getCachedSnapshot(sk);
  const render=(product,stages)=>{if(!product)return; workflowProductName=product.name; $("workflowProductName").textContent=product.name; workflowStages=(stages||[]).map(s=>({id:s.id,name:s.name,stage_order:s.stage_order})); renderWorkflowStages();};
  if(cachedProduct&&cachedStages!=null){render(cachedProduct,cachedStages); if(navigator.onLine)runInBackground(async()=>{const pr=await supabase.from("products").select("id,name").eq("id",workflowProductId).eq("seller_id",user.id).single(); const sr=await supabase.from("production_stages").select("id,name,stage_order").eq("product_id",workflowProductId).order("stage_order",{ascending:true}); if(!pr.error&&!sr.error){await cacheNamed(pk,pr.data); await cacheNamed(sk,sr.data||[]); render(pr.data,sr.data||[]);}}); return;}
  if(!navigator.onLine){render({id:workflowProductId,name:workflowProductName||"Product"},[]); return;} const pr=await supabase.from("products").select("id,name").eq("id",workflowProductId).eq("seller_id",user.id).single(); if(pr.error)throw pr.error; const sr=await supabase.from("production_stages").select("id,name,stage_order").eq("product_id",workflowProductId).order("stage_order",{ascending:true}); if(sr.error)throw sr.error; await cacheNamed(pk,pr.data); await cacheNamed(sk,sr.data||[]); render(pr.data,sr.data||[]);
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

async function loadQrProducts(){
  const select=$("qrProduct"); const render=(rows)=>{select.replaceChildren(); const p=document.createElement("option"); p.value=""; p.textContent="Select product"; select.appendChild(p); (rows||[]).forEach(x=>{const o=document.createElement("option");o.value=x.id;o.textContent=x.name;select.appendChild(o);});};
  const user=await getCurrentUser(); const key=`qr-products:${user.id}`; const cached=await getCachedSnapshot(key); if(cached!=null){qrProducts=cached;render(cached); if(navigator.onLine)runInBackground(async()=>{const r=await supabase.from("products").select("id,name,is_active").eq("seller_id",user.id).eq("is_active",true).order("name",{ascending:true}); if(!r.error){await cacheNamed(key,r.data||[]);qrProducts=r.data||[]; if(getRoute()==="qr")render(qrProducts);}}); return;} if(!navigator.onLine){qrProducts=[];render([]);return;} const r=await supabase.from("products").select("id,name,is_active").eq("seller_id",user.id).eq("is_active",true).order("name",{ascending:true}); if(r.error)throw r.error; await cacheNamed(key,r.data||[]);qrProducts=r.data||[];render(qrProducts);
}


async function loadQrSeries(){
  const list=$("qrSeriesList"); list.replaceChildren(); $("emptyQrState").hidden=true; const user=await getCurrentUser(); const key=`qr-series:${user.id}`;
  const render=(snapshot)=>{const data=snapshot?.data||[],rows=snapshot?.reservationRows||[]; if(getRoute()!=="qr")return; const groups=new Map(); data.forEach(q=>{const k=`${q.product_id}::${q.series_name}`;if(!groups.has(k))groups.set(k,{productId:q.product_id,productName:q.products?.name||"Product",seriesName:q.series_name||"Unnamed Series",total:0,available:0,assigned:0,revoked:0,reserved:0,reservedByDevice:0});const g=groups.get(k);g.total++;if(q.status==="available")g.available++;else if(q.status==="assigned")g.assigned++;else if(q.status==="revoked")g.revoked++;});rows.forEach(r=>{const q=r.qr_codes; if(!q)return; const g=groups.get(`${q.product_id}::${q.series_name}`); if(g){g.reserved++;if(r.device_id===getOfflineDeviceId())g.reservedByDevice++;}}); if(!groups.size){$("emptyQrState").hidden=false;return;} const f=document.createDocumentFragment();groups.forEach(g=>f.appendChild(createQrSeriesCard(g)));list.appendChild(f);};
  const cached=await getCachedSnapshot(key);
  if(cached!=null){render(cached);if(navigator.onLine)runInBackground(async()=>{try{const fresh=await (async()=>{let reservationRows=[];try{const rr=await supabase.from("offline_qr_reservations").select("qr_code_id,device_id,qr_codes(product_id,series_name)").eq("seller_id",user.id);if(!rr.error)reservationRows=rr.data||[];}catch(_){}const r=await supabase.from("qr_codes").select(`id,product_id,series_name,series_sequence,code,status,order_item_id,created_at,products(name)`).eq("seller_id",user.id).order("created_at",{ascending:false});if(r.error)throw r.error;return{data:r.data||[],reservationRows};})();await cacheNamed(key,fresh);render(fresh);}catch(_){}});return;}
  if(!navigator.onLine){render(null);return;} const fresh=await (async()=>{let reservationRows=[];try{const rr=await supabase.from("offline_qr_reservations").select("qr_code_id,device_id,qr_codes(product_id,series_name)").eq("seller_id",user.id);if(!rr.error)reservationRows=rr.data||[];}catch(_){}const r=await supabase.from("qr_codes").select(`id,product_id,series_name,series_sequence,code,status,order_item_id,created_at,products(name)`).eq("seller_id",user.id).order("created_at",{ascending:false});if(r.error)throw r.error;return{data:r.data||[],reservationRows};})();await cacheNamed(key,fresh);render(fresh);
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
    `Available: ${group.available} · Reserved: ${group.reserved} · Assigned: ${group.assigned} · Revoked: ${group.revoked}`;


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

  const reserve = document.createElement("button");
  reserve.type = "button";
  reserve.className = "secondary-button";
  reserve.textContent = group.reservedByDevice > 0 ? `Reserved for Offline (${group.reservedByDevice})` : "Reserve for Offline";
  reserve.disabled = group.available < 1 && group.reservedByDevice < 1;
  reserve.addEventListener("click", async () => {
    if (group.reservedByDevice > 0) {
      if (!window.confirm(`Release your ${group.reservedByDevice} reserved QR pair(s) from this series?`)) return;
      await releaseOfflineQrReservations(group.productId, group.seriesName);
      return;
    }
    const max = Math.max(1, group.available);
    const raw = window.prompt(`How many QR pairs do you want to reserve for offline use? (1-${max})`, String(Math.min(10, max)));
    if (raw === null) return;
    const quantity = Number(raw);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) { alert(`Enter a whole number between 1 and ${max}.`); return; }
    await reserveOfflineQrSeries(group.productId, group.seriesName, quantity);
  });
  actions.appendChild(reserve);


  card.append(
    title,
    product,
    total,
    status,
    actions
  );


  return card;

}

async function reserveOfflineQrSeries(productId, seriesName, quantity) {
  try {
    const { data, error } = await supabase.rpc("reserve_qr_codes_for_offline", {
      p_product_id: productId,
      p_series_name: seriesName,
      p_quantity: quantity,
      p_device_id: getOfflineDeviceId()
    });
    if (error) throw error;
    const count = Number(data) || 0;
    await refreshOfflineQrCache();
    alert(`${count} QR pair${count === 1 ? "" : "s"} reserved for this device.`);
    await loadQrSeries();
  } catch (error) {
    console.error("Offline QR reservation failed:", error);
    alert(error?.message || "Unable to reserve QR codes for offline use.");
  }
}

async function releaseOfflineQrReservations(productId, seriesName) {
  try {
    const { data, error } = await supabase.rpc("release_qr_reservations_for_offline", {
      p_product_id: productId,
      p_series_name: seriesName,
      p_device_id: getOfflineDeviceId()
    });
    if (error) throw error;
    alert(`${Number(data) || 0} reserved QR pair(s) released.`);
    await refreshOfflineQrCache();
    await loadQrSeries();
  } catch (error) {
    console.error("Offline QR release failed:", error);
    alert(error?.message || "Unable to release QR reservations.");
  }
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


    const cachedFirst=await getOfflineQr(token);
    if(cachedFirst && !cachedFirst.used){ await stopQrScanner(); pendingQrToken=cachedFirst.public_token; pendingProduct=cachedFirst.product; prepareOrderCreation({public_token:cachedFirst.public_token,products:cachedFirst.product}); if(cachedFirst.status==="assigned"&&cachedFirst.order_item_id){ try{currentOrderId=await getOrderIdFromItem(cachedFirst.order_item_id);navigate("order-detail");return;}catch(_){}} navigate("order-create"); return; }

    orderSaveBusy = true;
  const cachedQr=await getOfflineQr(pendingQrToken);
  if(!navigator.onLine && (!cachedQr || cachedQr.used)){ $("orderCreateMessage").textContent="This QR is not reserved and available for offline use on this device."; orderSaveBusy=false; return; }
  try{
    const row=await enqueueOfflineOrder({qrToken:pendingQrToken,productId:pendingProduct?.id||cachedQr?.product_id||null,customerId,customerName,customerPhone,quantity,downpayment,productName:pendingProduct?.name||"Product",unitPrice:Number(pendingProduct?.default_price)||0,total});
    await markOfflineQrUsed(pendingQrToken,row.clientOrderId); await cacheLocalOrderBundle(row.clientOrderId,row.payload); currentOrderId=row.clientOrderId;
    $("orderCreateMessage").textContent=navigator.onLine?"Saved to device. Syncing…":"Saved locally. Waiting to sync when you reconnect."; $("orderCreateMessage").classList.add("success-message"); await updateConnectivityIndicator(); navigate("order-detail"); if(navigator.onLine)runInBackground(syncOfflineOrders);
  }catch(error){ console.error("Order save failed:",error); $("orderCreateMessage").textContent=error?.message||"Unable to save the order."; }
  return;


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
            downpayment,

          p_device_id:
            getOfflineDeviceId()

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

async function loadOrderDetail(orderId){
  currentOrderTotal=0; currentOrderPaid=0; $("orderDetailItems").replaceChildren(); $("orderDetailMessage").textContent=""; const effective=await resolveOrderId(orderId); const user=await getCurrentUser(); const ok=`order:${effective}`, ik=`order-items:${effective}`, pk=`order-payments-full:${effective}`;
  let order=await getCachedSnapshot(ok), items=await getCachedSnapshot(ik), payments=await getCachedSnapshot(pk); if(payments==null)payments=await getCachedSnapshot(`order-payments:${effective}`);
  const paint=(o,it,pay)=>{ if(!o)return; $("orderDetailTitle").textContent=`Order #${o.order_number}`; $("orderDetailNumber").textContent=`#${o.order_number}`; $("orderDetailCustomerName").textContent=o.customers?.name||"Customer"; $("orderDetailCustomer").textContent=o.customers?.phone||""; let total=0; (it||[]).forEach(item=>{total+=Number(item.total_price)||0; const row=document.createElement("div");row.className="order-detail-item";const left=document.createElement("div");const name=document.createElement("strong");name.textContent=item.product_name;const qty=document.createElement("span");qty.textContent=` × ${item.quantity}`;left.append(name,qty);const price=document.createElement("strong");price.textContent=formatPrice(item.total_price);row.append(left,price);if(item.cancelled_at)row.classList.add("is-cancelled");const panel=document.createElement("section");panel.className="production-panel";renderProductionPanel(item,panel);$("orderDetailItems").append(row,panel);}); const paid=(pay||[]).reduce((s,x)=>s+(Number(x.amount)||0),0);$("orderDetailTotal").textContent=formatPrice(total);$("orderDetailPaid").textContent=formatPrice(paid);currentOrderTotal=total;currentOrderPaid=paid;$("orderDetailBalance").textContent=formatPrice(Math.max(0,total-paid));};
  if(order&&items!=null&&payments!=null){paint(order,items,payments); if(navigator.onLine)runInBackground(async()=>{try{const o=await supabase.from("orders").select(`id,order_number,customer_id,created_at,customers(id,name,phone)`).eq("id",effective).eq("seller_id",user.id).single();const i=await supabase.from("order_items").select(`id,product_name,quantity,unit_price,total_price,workflow_snapshot,cancelled_at`).eq("order_id",effective).eq("seller_id",user.id).order("created_at",{ascending:true});const p=await supabase.from("payments").select("id,amount,proof_status,payment_type,created_at").eq("order_id",effective).eq("seller_id",user.id);if(!o.error&&!i.error&&!p.error){await cacheNamed(ok,o.data);await cacheNamed(ik,i.data||[]);await cacheNamed(pk,p.data||[]);if(getRoute()==="order-detail")paint(o.data,i.data||[],p.data||[]);}}catch(e){console.warn("Background order refresh failed:",e);}}); return;}
  if(!navigator.onLine)throw new Error("This order has not been cached for offline use yet."); const o=await supabase.from("orders").select(`id,order_number,customer_id,created_at,customers(id,name,phone)`).eq("id",effective).eq("seller_id",user.id).single();if(o.error)throw o.error;const i=await supabase.from("order_items").select(`id,product_name,quantity,unit_price,total_price,workflow_snapshot,cancelled_at`).eq("order_id",effective).eq("seller_id",user.id).order("created_at",{ascending:true});if(i.error)throw i.error;const p=await supabase.from("payments").select("id,amount,proof_status,payment_type,created_at").eq("order_id",effective).eq("seller_id",user.id);if(p.error)throw p.error;order=o.data;items=i.data||[];payments=p.data||[];await cacheNamed(ok,order);await cacheNamed(ik,items);await cacheNamed(pk,payments);paint(order,items,payments);
}


// ============================================================
// PRODUCTION EXECUTION
// ============================================================

function normaliseWorkflowSnapshot(snapshot) {

  if (!Array.isArray(snapshot)) {
    return [];
  }

  return snapshot
    .map((stage, index) => ({
      stage_order: Number(stage?.stage_order ?? index + 1),
      name: String(stage?.name ?? `Stage ${index + 1}`).trim() || `Stage ${index + 1}`
    }))
    .filter((stage) => Number.isInteger(stage.stage_order) && stage.stage_order > 0)
    .sort((a, b) => a.stage_order - b.stage_order);

}


async function getProductionStageLogs(orderItemId) {
  const cacheKey = `stage-logs:${orderItemId}`;
  if (navigator.onLine) {
    try {
      const result = await supabase.from("stage_logs").select("id,stage_order,stage_name,action,note,proof_photo_path,occurred_at,performed_by_user_id").eq("order_item_id", orderItemId).order("occurred_at", { ascending:true });
      if (result.error) throw result.error;
      const data = result.data || [];
      await cacheNamed(cacheKey, data);
      return data;
    } catch (error) {
      const cached = await getCachedSnapshot(cacheKey);
      if (cached != null) return cached;
      throw error;
    }
  }
  return (await getCachedSnapshot(cacheKey)) || [];
}


function getLatestStageLog(logs, stageOrder) {

  const matching =
    logs.filter(
      (log) => Number(log.stage_order) === Number(stageOrder)
    );

  return matching.length ? matching[matching.length - 1] : null;

}


function getProductionStageStates(workflow, logs) {

  let previousFinished = true;

  return workflow.map((stage) => {

    const latest =
      getLatestStageLog(
        logs,
        stage.stage_order
      );

    const finished = latest?.action === "finished";
    const available = previousFinished && !finished;

    if (!finished) {
      previousFinished = false;
    }

    return {
      ...stage,
      latest,
      finished,
      available
    };

  });

}


function productionStatusLabel(states) {

  if (!states.length) {
    return "No workflow";
  }

  if (states.every((stage) => stage.finished)) {
    return "Completed";
  }

  const active = states.find((stage) => stage.available);

  return active
    ? `${active.name} is next`
    : "In progress";

}


function createProductionStageRow(
  item,
  stage,
  panel
) {

  const row =
    document.createElement("div");

  row.className = "production-stage-row";

  if (stage.finished) {
    row.classList.add("is-finished");
  } else if (stage.available) {
    row.classList.add("is-current");
  }

  const main =
    document.createElement("div");

  main.className = "production-stage-main";

  const title =
    document.createElement("div");

  title.className = "production-stage-title";

  const marker =
    document.createElement("span");

  marker.className = "production-stage-marker";
  marker.textContent = stage.finished ? "✓" : String(stage.stage_order);

  const name =
    document.createElement("strong");

  name.textContent = stage.name;

  title.append(marker, name);

  const status =
    document.createElement("span");

  status.className = "production-stage-status";
  status.textContent =
    stage.finished ? `Finished${stage.latest?.occurred_at ? ` · ${formatDate(stage.latest.occurred_at)}` : ""}`
    : stage.available ? "Next stage" : "Waiting";

  main.append(title, status);

  const actions =
    document.createElement("div");

  actions.className = "production-stage-actions";

  if (stage.available && !item.cancelled_at) {

    const finishButton =
      document.createElement("button");

    finishButton.type = "button";
    finishButton.textContent = "Finish Stage";
    finishButton.addEventListener("click", () => {
      openFinishStageEditor(item, stage, panel);
    });

    actions.appendChild(finishButton);

  }

  const latestFinishedStage =
    stage.latest?.action === "finished";

  if (
    latestFinishedStage &&
    !item.cancelled_at &&
    stagesCanBeSentBack(stage, item, panel)
  ) {

    const sendBackButton =
      document.createElement("button");

    sendBackButton.type = "button";
    sendBackButton.className = "secondary-button";
    sendBackButton.textContent = "Send Back";
    sendBackButton.addEventListener("click", () => {
      sendBackProductionStage(item, stage, panel);
    });

    actions.appendChild(sendBackButton);

  }

  if (stage.finished && stage.latest?.proof_photo_path) {

    const viewButton =
      document.createElement("button");

    viewButton.type = "button";
    viewButton.className = "secondary-button";
    viewButton.textContent = "View Proof";
    viewButton.addEventListener("click", () => {
      viewProductionProof(stage.latest.proof_photo_path);
    });

    actions.appendChild(viewButton);

  }

  row.append(main, actions);
  return row;

}


function stagesCanBeSentBack(
  targetStage,
  item,
  panel
) {

  const rows =
    panel.querySelectorAll(".production-stage-row.is-finished");

  if (!rows.length) {
    return false;
  }

  const highestFinishedOrder =
    Math.max(
      ...Array.from(rows).map((row) => {
        const marker = row.querySelector(".production-stage-marker");
        return Number(marker?.textContent === "✓" ? row.dataset.stageOrder : row.dataset.stageOrder) || 0;
      })
    );

  return Number(targetStage.stage_order) === Number(panel.dataset.latestFinishedStage);

}


function setStageRowDataset(panel, states) {

  const latestFinished =
    [...states]
      .filter((stage) => stage.finished)
      .sort((a, b) => b.stage_order - a.stage_order)[0];

  panel.dataset.latestFinishedStage =
    latestFinished ? String(latestFinished.stage_order) : "";

}


async function renderProductionPanel(item, panel) {

  panel.innerHTML = "";

  const heading =
    document.createElement("div");

  heading.className = "production-panel-heading";

  const title =
    document.createElement("h3");
  title.textContent = "Production";

  const status =
    document.createElement("span");
  status.className = "production-overall-status";
  status.textContent = "Loading…";

  heading.append(title, status);
  panel.appendChild(heading);

  const workflow =
    normaliseWorkflowSnapshot(item.workflow_snapshot);

  if (!workflow.length) {
    status.textContent = "No workflow defined";

    const empty = document.createElement("p");
    empty.className = "production-empty";
    empty.textContent = "This order item has no production stages.";
    panel.appendChild(empty);
    return;
  }

  try {

    const logs =
      await getProductionStageLogs(item.id);

    const states =
      getProductionStageStates(workflow, logs);

    status.textContent =
      productionStatusLabel(states);

    setStageRowDataset(panel, states);

    const list =
      document.createElement("div");
    list.className = "production-stage-list";

    states.forEach((stage) => {
      const row = createProductionStageRow(item, stage, panel);
      row.dataset.stageOrder = String(stage.stage_order);
      list.appendChild(row);
    });

    panel.appendChild(list);

    if (item.cancelled_at) {
      const note = document.createElement("p");
      note.className = "production-cancelled-note";
      note.textContent = "This order item is cancelled, so production updates are disabled.";
      panel.appendChild(note);
    }

  } catch (error) {

    console.error("Production load failed:", error);
    status.textContent = "Unable to load";

    const message = document.createElement("p");
    message.className = "production-error";
    message.textContent = error?.message || "Unable to load production progress.";
    panel.appendChild(message);

  }

}


function openFinishStageEditor(item, stage, panel) {

  if (productionBusyItemId) {
    return;
  }

  const existing =
    panel.querySelector(".production-finish-editor");

  if (existing) {
    existing.remove();
  }

  const editor =
    document.createElement("div");
  editor.className = "production-finish-editor";

  const title = document.createElement("h4");
  title.textContent = `Finish: ${stage.name}`;

  const noteLabel = document.createElement("label");
  noteLabel.textContent = "Note (optional)";
  const note = document.createElement("textarea");
  note.rows = 3;
  note.maxLength = 500;
  note.placeholder = "Add an optional note about this stage.";

  const photoLabel = document.createElement("label");
  photoLabel.textContent = "Proof photo (optional)";
  const photo = document.createElement("input");
  photo.type = "file";
  photo.accept = "image/jpeg,image/png,image/webp";

  const actions = document.createElement("div");
  actions.className = "production-editor-actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary-button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => editor.remove());

  const finish = document.createElement("button");
  finish.type = "button";
  finish.textContent = "Confirm Finished";
  finish.addEventListener("click", async () => {
    await finishProductionStage(item, stage, note.value.trim(), photo.files?.[0] || null, panel, finish);
  });

  actions.append(cancel, finish);

  editor.append(
    title,
    noteLabel,
    note,
    photoLabel,
    photo,
    actions
  );

  panel.appendChild(editor);

}


async function finishProductionStage(
  item,
  stage,
  note,
  file,
  panel,
  button
) {

  if (productionBusyItemId) {
    return;
  }

  productionBusyItemId = item.id;
  setLoading(button, "Saving…");

  let proofPath = null;

  try {

    const user = await getCurrentUser();

    const { data: result, error } =
      await supabase.rpc(
        "finish_production_stage",
        {
          p_order_item_id: item.id,
          p_stage_order: stage.stage_order,
          p_stage_name: stage.name,
          p_note: note || null
        }
      );

    if (error) {
      throw error;
    }

    const logId = result?.stage_log_id;

    if (file && logId) {

      const extension =
        file.name.split(".").pop()?.toLowerCase() || "jpg";

      proofPath = `${user.id}/${item.id}/${stage.stage_order}-${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } =
        await supabase.storage
          .from("production-proofs")
          .upload(proofPath, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type
          });

      if (uploadError) {
        console.warn("Proof upload failed; stage remains finished:", uploadError);
      } else {
        const { error: updateError } =
          await supabase
            .from("stage_logs")
            .update({ proof_photo_path: proofPath })
            .eq("id", logId)
            .eq("order_item_id", item.id);

        if (updateError) {
          console.warn("Proof path update failed:", updateError);
        }
      }

    }

    await loadOrderDetail(currentOrderId);

  } catch (error) {

    console.error("Finish production stage failed:", error);
    alert(error?.message || "Unable to finish this production stage.");

  } finally {
    productionBusyItemId = null;
    resetButton(button, "Confirm Finished");
  }

}


async function sendBackProductionStage(
  item,
  stage
) {

  if (productionBusyItemId) {
    return;
  }

  const confirmed =
    window.confirm(
      `Send “${stage.name}” back for rework? This will make it the current production stage again.`
    );

  if (!confirmed) {
    return;
  }

  productionBusyItemId = item.id;

  try {

    const { error } =
      await supabase.rpc(
        "send_back_production_stage",
        {
          p_order_item_id: item.id,
          p_stage_order: stage.stage_order,
          p_stage_name: stage.name
        }
      );

    if (error) {
      throw error;
    }

    await loadOrderDetail(currentOrderId);

  } catch (error) {

    console.error("Send back production stage failed:", error);
    alert(error?.message || "Unable to send this stage back.");

  } finally {
    productionBusyItemId = null;
  }

}


async function viewProductionProof(path) {

  if (!path) {
    return;
  }

  try {

    const { data, error } =
      await supabase.storage
        .from("production-proofs")
        .createSignedUrl(path, 300);

    if (error) {
      throw error;
    }

    if (!data?.signedUrl) {
      throw new Error("Proof photo could not be opened.");
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");

  } catch (error) {

    console.error("Proof photo open failed:", error);
    alert(error?.message || "Unable to open the proof photo.");

  }

}


// ============================================================
// PAYMENTS
// ============================================================

async function loadPayments(orderId){
 const list=$("paymentList"); list.replaceChildren(); const user=await getCurrentUser(); const key=`order-payments-full:${orderId}`; let payments=await getCachedSnapshot(key); const render=(rows)=>{list.replaceChildren();if(!rows?.length){const e=document.createElement("p");e.className="payment-empty";e.textContent="No payments recorded yet.";list.appendChild(e);return;}const f=document.createDocumentFragment();rows.forEach(p=>{const r=document.createElement("div");r.className="payment-row";const l=document.createElement("div");const tt=document.createElement("strong");tt.textContent=paymentTypeLabel(p.payment_type);const mt=document.createElement("span");mt.textContent=formatDate(p.created_at);l.append(tt,mt);const rr=document.createElement("div");rr.className="payment-row-right";const a=document.createElement("strong");a.textContent=formatPrice(p.amount);rr.appendChild(a);r.append(l,rr);f.appendChild(r);});list.appendChild(f);}; const fetcher=async()=>{const r=await supabase.from("payments").select(`id,amount,payment_type,proof_status,created_at`).eq("order_id",orderId).eq("seller_id",user.id).order("created_at",{ascending:true});if(r.error)throw r.error;return r.data||[];}; if(payments!=null){render(payments);if(navigator.onLine)runInBackground(async()=>{const fresh=await fetcher();await cacheNamed(key,fresh);if(getRoute()==="order-detail")render(fresh);});return;} if(!navigator.onLine){render([]);return;}payments=await fetcher();await cacheNamed(key,payments);render(payments);
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
// AUTH STATE + ROUTING
// ============================================================

supabase.auth.onAuthStateChange(
  (
    _event,
    currentSession
  ) => {

    setTimeout(
      () => {

        if (currentSession || readPersistedSession()?.user) { renderApplication(); } else { showScreen(getRoute() === "register" ? "register" : "login"); }

      },
      0
    );

  }
);


initializeOfflineFoundation();

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
