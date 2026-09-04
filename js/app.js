import { supabase, readPersistedSession, ensureSupabase } from "./supabase.js";


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
let runtimeOffline = !navigator.onLine;
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
    type: payload?.action === "add_item" ? "add_order_item" : "create_order",
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
  await requestOfflineBackgroundSync();
  return row;
}

async function requestOfflineBackgroundSync() {
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration?.sync) await registration.sync.register("ordeli-offline-orders");
  } catch (error) {
    console.debug("Background offline sync is unavailable:", error);
  }
}

async function getOfflineQueueRows({ includeFinished = false } = {}) {
  const db = await openOfflineDb();
  if (!db) return [];
  return new Promise(resolve => {
    const request = db.transaction(OFFLINE_QUEUE_STORE, "readonly").objectStore(OFFLINE_QUEUE_STORE).getAll();
    request.onsuccess = () => {
      const rows = (request.result || []).filter(row => ["create_order", "add_order_item"].includes(row.type));
      resolve(includeFinished ? rows : rows.filter(row => ["waiting", "error", "syncing"].includes(row.status)));
    };
    request.onerror = () => resolve([]);
  });
}

async function getQueuedOrders() {
  return getOfflineQueueRows();
}

async function findOfflineCreateRow(clientOrderId) {
  if (!clientOrderId) return null;
  const rows = await getOfflineQueueRows({ includeFinished: true });
  return rows.find(row => row.type === "create_order" && row.clientOrderId === clientOrderId) || null;
}

async function resolveServerOrderId(orderId, { attemptSync = true } = {}) {
  if (!orderId) return null;
  if (!String(orderId).startsWith("offline:")) return orderId;
  const clientOrderId = String(orderId).slice("offline:".length);
  let parent = await findOfflineCreateRow(clientOrderId);
  if (parent?.serverResult?.order_id) return parent.serverResult.order_id;
  if (attemptSync && navigator.onLine) {
    try { await syncOfflineOrders(); } catch (_) {}
    parent = await findOfflineCreateRow(clientOrderId);
    if (parent?.serverResult?.order_id) return parent.serverResult.order_id;
  }
  return null;
}

async function reconcileOrderCacheFromServer(serverOrderId) {
  if (!serverOrderId || !navigator.onLine) return null;
  const user = await getCurrentUser();
  if (!user?.id) return null;
  const [orderResult, itemsResult, paymentsResult] = await Promise.all([
    supabase.from("orders").select("id,order_number,customer_id,fulfillment_type,event_id,pickup_status,handed_over_at,cancelled_at,created_at,updated_at,customers(id,name,phone)").eq("id", serverOrderId).eq("seller_id", user.id).single(),
    supabase.from("order_items").select("id,product_name,quantity,unit_price,total_price,workflow_snapshot,cancelled_at,created_at,updated_at").eq("order_id", serverOrderId).eq("seller_id", user.id).order("created_at", { ascending: true }),
    supabase.from("payments").select("id,amount,proof_status,payment_type,proof_path,rejection_reason,confirmed_at,created_at").eq("order_id", serverOrderId).eq("seller_id", user.id).order("created_at", { ascending: true })
  ]);
  if (orderResult.error) throw orderResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (paymentsResult.error) throw paymentsResult.error;
  await cacheNamed(`order:${serverOrderId}`, { ...orderResult.data, offline: false, sync_status: "synchronized" });
  await cacheNamed(`order-items:${serverOrderId}`, itemsResult.data || []);
  await cacheNamed(`order-payments:${serverOrderId}`, paymentsResult.data || []);
  return { order: orderResult.data, items: itemsResult.data || [], payments: paymentsResult.data || [] };
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
  offlineSyncInProgress = true;
  try {
    try { await ensureSupabase(); } catch (_) { return; }
    const session = await supabase.auth.getSession();
    if (!session?.data?.session?.user?.id) return;

    const queue = (await getQueuedOrders())
      .filter(row => !row.nextAttemptAt || Date.now() >= Number(row.nextAttemptAt))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // A reconnect/reload should be enough to drain the queue.  Never leave a
    // previously errored row stranded just because it was marked `error`;
    // due retries are eligible again immediately.

    for (const row of queue) {
      if (!navigator.onLine) break;
      row.status = "syncing";
      row.attempts = Number(row.attempts || 0) + 1;
      row.nextAttemptAt = null;
      await updateQueuedOrder(row);
      await updateConnectivityIndicator();
      try {
        const p = row.payload || {};
        if (row.type === "add_order_item") {
          let serverOrderId = p.orderId || null;
          if (String(serverOrderId || "").startsWith("offline:")) serverOrderId = await resolveServerOrderId(serverOrderId);
          if (!serverOrderId && p.parentClientOrderId) {
            const parent = await findOfflineCreateRow(p.parentClientOrderId);
            serverOrderId = parent?.serverResult?.order_id || null;
          }
          if (!serverOrderId) throw new Error("The parent order is still waiting to sync.");
          const { data, error } = await supabase.rpc("add_order_item_online", {
            p_order_id: serverOrderId,
            p_qr_public_token: p.qrToken,
            p_quantity: p.quantity,
            p_device_id: row.deviceId
          });
          if (error) throw error;
          if (!data?.order_item_id) throw new Error("The item was not added to the order.");
          row.serverResult = { ...(data || {}), order_id: serverOrderId };
          try { await reconcileOrderCacheFromServer(serverOrderId); } catch (refreshError) { console.warn("Order reconciliation after item sync failed; local state retained.", refreshError); }
          if (currentOrderId === p.orderId && String(p.orderId).startsWith("offline:")) currentOrderId = serverOrderId;
        } else {
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
          row.serverResult = data;
          if (data?.order_id) {
            const oldId = `offline:${row.clientOrderId}`;
            const serverId = data.order_id;
            const cachedOrder = await getCachedSnapshot(`order:${oldId}`);
            const cachedItems = await getCachedSnapshot(`order-items:${oldId}`);
            const cachedPayments = await getCachedSnapshot(`order-payments:${oldId}`);
            await cacheNamed(`order:${serverId}`, { ...(cachedOrder || {}), id: serverId, order_number: data.order_number || cachedOrder?.order_number, offline: false, sync_status: "synchronized" });
            if (cachedItems != null) await cacheNamed(`order-items:${serverId}`, cachedItems);
            if (cachedPayments != null) await cacheNamed(`order-payments:${serverId}`, cachedPayments);
            if (currentOrderId === oldId) currentOrderId = serverId;
            try { sessionStorage.setItem(`ordeli-order-detail-mode:${serverId}`, "fresh"); } catch (_) {}
            try { await reconcileOrderCacheFromServer(serverId); } catch (refreshError) { console.warn("Server reconciliation after order sync failed; local snapshot retained.", refreshError); }
          }
        }
        row.status = "synced";
        row.syncedAt = new Date().toISOString();
        row.lastError = null;
        row.nextAttemptAt = null;
        await updateQueuedOrder(row);
      } catch (error) {
        const message = error?.message || "Synchronization failed.";
        row.status = navigator.onLine ? "error" : "waiting";
        row.lastError = message;
        row.lastErrorAt = new Date().toISOString();
        // Keep retries bounded, but make the first online retry fast enough
        // that reconnecting or reloading the app visibly drains the queue.
        row.nextAttemptAt = navigator.onLine
          ? Date.now() + Math.min(8000, 1000 * (2 ** Math.min(3, Number(row.attempts || 1) - 1)))
          : null;
        await updateQueuedOrder(row);
        console.error("Offline queue sync failed:", error);
        if (!navigator.onLine) break;
      }
    }
  } finally {
    offlineSyncInProgress = false;
    await updateConnectivityIndicator();
    if (currentOrderId && String(currentOrderId).startsWith("offline:") && navigator.onLine) {
      const resolved = await resolveServerOrderId(currentOrderId, { attemptSync: false }).catch(() => null);
      if (resolved) {
        currentOrderId = resolved;
        if (getRoute() === "order-detail") { try { await loadOrderDetail(resolved); } catch (_) {} }
      }
    }
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
function scheduleOfflineSync(delay = 0) {
  window.clearTimeout(scheduleOfflineSync._timer);
  scheduleOfflineSync._timer = window.setTimeout(async () => {
    try { await syncOfflineOrders(); } catch (error) { console.error("Offline queue sync failed:", error); }
  }, Math.max(0, delay));
}

async function hasPendingOfflineWork() {
  const count = await getPendingSyncCount();
  return count > 0;
}

function initializeOfflineFoundation() {
  ensureConnectivityIndicator();
  runtimeOffline = !navigator.onLine;
  updateConnectivityIndicator();

  window.addEventListener("online", async () => {
    runtimeOffline = false;
    // Mark the runtime online immediately and drain the queue.  Do not wait
    // for a later polling tick.
    await updateConnectivityIndicator();
    // Reinitialize Supabase and immediately reconcile anything that was saved
    // while offline. The seller UI is not reloaded unless it needs it.
    try { await ensureSupabase(); } catch (error) { console.warn("Supabase initialization after reconnect failed:", error); return; }
    try { await refreshOfflineQrCache(); } catch (_) {}
    await requestOfflineBackgroundSync();
    scheduleOfflineSync(0);
    if (getRoute() === "order-create") restorePendingOrderDraft();
    if (getRoute() === "order-detail" && currentOrderId) {
      if (String(currentOrderId).startsWith("offline:")) {
        const resolved = await resolveServerOrderId(currentOrderId, { attemptSync: true }).catch(() => null);
        if (resolved) currentOrderId = resolved;
      }
      try { await loadOrderDetail(currentOrderId); } catch (_) {}
    }
    if (getRoute() !== "login" && getRoute() !== "register" && getRoute() !== "order-create" && getRoute() !== "order-detail") {
      renderApplication();
    }
  });

  window.addEventListener("offline", async () => {
    runtimeOffline = true;
    await updateConnectivityIndicator();
  });

  window.addEventListener("focus", () => { scheduleOfflineSync(0); });
  window.addEventListener("pageshow", () => { scheduleOfflineSync(0); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleOfflineSync(0);
  });

  navigator.serviceWorker?.addEventListener("message", event => {
    if (event.data?.type === "ordeli-sync-request") scheduleOfflineSync(0);
  });

  // navigator.onLine can be stale in PWAs. A frequent lightweight cycle makes
  // pending work self-healing even when the browser does not emit an `online`
  // event (for example, after Wi-Fi handoff or captive portal recovery).
  window.setInterval(async () => {
    await updateConnectivityIndicator();
    if (!navigator.onLine || offlineSyncInProgress) return;
    if (await hasPendingOfflineWork()) scheduleOfflineSync(0);
  }, 3000);

  refreshOfflineQrCache();
  // Try once at boot and again shortly afterwards.  This covers a PWA that
  // starts while connectivity is coming back before the browser emits the
  // `online` event.
  scheduleOfflineSync(0);
  requestOfflineBackgroundSync();
  scheduleOfflineSync._bootRetry = window.setTimeout(() => scheduleOfflineSync(0), 1500);
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

  orders:
    $("ordersScreen"),

  events:
    $("eventsScreen"),

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
let pendingAddToOrderId = null;
let currentOrderId = null;
let currentOrderShowProduction = false;

let currentOrderTotal = 0;
let currentOrderPaid = 0;

let productionBusyItemId = null;
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
  "order-detail",
  "orders",
  "events"
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
  const result = await supabase.auth.getSession();
  if (result?.error) throw result.error;
  return result?.data?.session || readPersistedSession();
}

async function getCurrentUser() {
  const session = await getSession();
  if (!session?.user) throw new Error("No authenticated user.");
  return session.user;
}


// ============================================================
// SELLER
// ============================================================

async function getSeller(userId) {
  const cacheKey = `seller:${userId}`;
  const cached = await getCachedSnapshot(cacheKey);

  // The cached seller profile is sufficient to boot the seller app offline.
  // When online, refresh it in the background instead of making startup
  // depend on a network round-trip.
  if (cached) {
    if (navigator.onLine && !runtimeOffline) {
      queueMicrotask(async () => {
        try {
          await ensureSupabase();
          const { data, error } = await supabase
            .from("sellers")
            .select(`id, email, login_method, google_id, shop_name, shop_address, shop_logo_path`)
            .eq("id", userId)
            .maybeSingle();
          if (!error && data) await cacheNamed(cacheKey, data);
        } catch (_) {}
      });
    }
    return cached;
  }

  if (!navigator.onLine || runtimeOffline) return null;

  try {
    await ensureSupabase();
    const { data, error } = await supabase.from("sellers").select(`id, email, login_method, google_id, shop_name, shop_address, shop_logo_path`).eq("id", userId).maybeSingle();
    if (error) throw error;
    if (data) await cacheNamed(cacheKey, data);
    return data;
  } catch (error) {
    throw error;
  }
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

    if (!runtimeOffline && navigator.onLine) {
      try { await ensureSupabase(); } catch (_) {}
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
      if (!navigator.onLine || runtimeOffline) {
        throw new Error(
          "This seller profile has not been saved on this device yet. Open the app once while online before using it offline."
        );
      }
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
      if (!(pendingQrToken && pendingProduct)) restorePendingOrderDraft();
      showScreen("orderCreate");
      updateOrderCreateMode();
      toggleCustomerChoice();
      updateOrderCreateTotals();
      if (pendingAddToOrderId) renderAddToOrderContext();
      return;
    }


    if (getRoute() === "orders") {
      showScreen("orders");
      await loadOrders();
      return;
    }

    if (getRoute() === "events") {
      showScreen("events");
      await loadEvents();
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
    console.error("Application render error:", error);
    const sessionStillPresent = await getSession().catch(() => readPersistedSession());
    if (!sessionStillPresent) {
      showScreen(getRoute() === "register" ? "register" : "login");
      $("loginMessage").textContent = error?.message || "Unable to load the application.";
    } else {
      const route = getRoute();
      const screen = route === "order-detail" ? "orderDetail" : route;
      showScreen(screen);
      const ids = { products: "productMessage", workflow: "workflowMessage", qr: "qrMessage", scanner: "scannerMessage", "order-create": "orderCreateMessage", "order-detail": "orderDetailMessage", "shop-setup": "shopSetupMessage" };
      const target = $(ids[route]);
      if (target) target.textContent = error?.message || "Unable to load this screen.";
    }
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

async function renderHome(seller) {
  $("homeShopName").textContent = seller.shop_name || "My Shop";
  $("homeShopAddress").textContent = seller.shop_address || "";
  $("homeDashboardSubtitle").textContent = "Loading your shop activity…";
  // Never let a logo/network failure prevent the dashboard from appearing.
  showScreen("home");
  try { await loadHomeLogo(seller.shop_logo_path); } catch (error) { console.warn("Home logo unavailable:", error); }
  try {
    await loadHomeDashboard(seller.id);
  } catch (error) {
    console.warn("Dashboard refresh unavailable; using cached/local state.", error);
    const cached = await getCachedSnapshot(`dashboard:${seller.id}`);
    if (cached) {
      try { renderRecentOrders(cached.orders || [], cached.payments || []); } catch (_) {}
    }
    $("homeDashboardSubtitle").textContent = navigator.onLine ? "Unable to refresh right now" : "Offline · Showing saved shop activity";
  }
}

async function loadHomeDashboard(sellerId) {
  const cacheKey = `dashboard:${sellerId}`;
  let snapshot = null;
  if (!runtimeOffline && navigator.onLine) {
    try {
      const [ordersResult, paymentsResult, eventsResult] = await Promise.all([
        supabase.from("orders").select(`id,order_number,created_at,cancelled_at,event_id,fulfillment_type,pickup_status,customers(id,name,phone),order_items(id,product_name,quantity,total_price,workflow_snapshot,cancelled_at,stage_logs(id,stage_order,action,occurred_at),qr_code_id)` ).eq("seller_id", sellerId).order("created_at", { ascending: false }).limit(40),
        supabase.from("payments").select("id,order_id,amount,payment_type,proof_status,created_at").eq("seller_id", sellerId).order("created_at", { ascending: false }).limit(200),
        supabase.from("events").select("id,name,location,event_date,start_time,end_time,status").eq("seller_id", sellerId).gte("event_date", new Date().toISOString().slice(0,10)).order("event_date", { ascending: true }).order("start_time", { ascending: true }).limit(20)
      ]);
      if (ordersResult.error) throw ordersResult.error;
      if (paymentsResult.error) throw paymentsResult.error;
      if (eventsResult.error) throw eventsResult.error;
      snapshot = { orders: ordersResult.data || [], payments: paymentsResult.data || [], events: eventsResult.data || [], cachedAt: Date.now() };
      await cacheNamed(cacheKey, snapshot);
    } catch (error) {
      snapshot = await getCachedSnapshot(cacheKey);
      if (!snapshot) throw error;
    }
  } else {
    snapshot = await getCachedSnapshot(cacheKey);
  }
  snapshot = snapshot || { orders: [], payments: [], events: [] };
  const computed = computeOrderMetrics(snapshot.orders, snapshot.payments);
  $("attentionProduction").textContent = String(computed.production);
  $("attentionPayments").textContent = String(computed.paymentReviews);
  $("attentionReady").textContent = String(computed.ready);
  const upcomingEventIds = new Set(snapshot.events.filter(e => e.event_date).map(e => e.id));
  const eventOrders = snapshot.orders.filter(o => o.event_id && upcomingEventIds.has(o.event_id) && !o.cancelled_at).length;
  $("attentionEvents").textContent = String(eventOrders);
  $("homeDashboardSubtitle").textContent = `${computed.active} active order${computed.active === 1 ? "" : "s"} · ${computed.ready} ready for handover`;
  renderRecentOrders(snapshot.orders.slice(0, 8), snapshot.payments);
}

function computeOrderMetrics(orders, payments) {
  const paymentsByOrder = new Map();
  (payments || []).forEach(p => {
    const arr = paymentsByOrder.get(p.order_id) || [];
    arr.push(p);
    paymentsByOrder.set(p.order_id, arr);
  });
  let production = 0, paymentReviews = 0, ready = 0, active = 0;
  (orders || []).forEach(order => {
    if (order.cancelled_at) return;
    const items = order.order_items || [];
    const nonCancelled = items.filter(i => !i.cancelled_at);
    const productionComplete = nonCancelled.length > 0 && nonCancelled.every(isItemProductionComplete);
    if (!productionComplete) production += 1;
    const total = nonCancelled.reduce((sum, i) => sum + (Number(i.total_price) || 0), 0);
    const paid = (paymentsByOrder.get(order.id) || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const pendingProof = (paymentsByOrder.get(order.id) || []).some(p => p.proof_status === "pending_verification");
    if (pendingProof) paymentReviews += 1;
    const fullyPaid = paid >= total - 0.005;
    if (productionComplete && fullyPaid && !order.handed_over_at && !order.cancelled_at) ready += 1;
    active += 1;
  });
  return { production, paymentReviews, ready, active };
}

function isItemProductionComplete(item) {
  if (item.cancelled_at) return true;
  const workflow = normaliseWorkflowSnapshot(item.workflow_snapshot);
  if (!workflow.length) return false;
  const logs = item.stage_logs || [];
  const states = getProductionStageStates(workflow, logs);
  return states.every(stage => stage.status === "finished");
}

function orderProductionLabel(order) {
  const items = (order.order_items || []).filter(i => !i.cancelled_at);
  if (!items.length) return "Cancelled";
  if (items.every(isItemProductionComplete)) return "Completed";
  const active = items.find(i => !isItemProductionComplete(i));
  const workflow = normaliseWorkflowSnapshot(active?.workflow_snapshot);
  const states = active ? getProductionStageStates(workflow, active.stage_logs || []) : [];
  const next = states.find(stage => stage.status !== "finished");
  return next ? next.name : "In progress";
}

function renderRecentOrders(orders, payments) {
  const list = $("homeRecentOrders");
  list.replaceChildren();
  if (!orders.length) {
    const empty = document.createElement("p"); empty.className = "dashboard-empty"; empty.textContent = "No orders yet. Scan a customer QR to create your first order."; list.appendChild(empty); return;
  }
  const paymentMap = new Map();
  payments.forEach(p => paymentMap.set(p.order_id, [...(paymentMap.get(p.order_id) || []), p]));
  orders.forEach(order => {
    const button = document.createElement("button"); button.type = "button"; button.className = "dashboard-order-row";
    const name = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = `#${order.order_number} · ${order.customers?.name || "Customer"}`;
    const meta = document.createElement("span"); meta.textContent = `${order.order_items?.length || 0} item${(order.order_items?.length || 0) === 1 ? "" : "s"} · ${orderProductionLabel(order)}`;
    name.append(title, meta);
    const total = (order.order_items || []).filter(i => !i.cancelled_at).reduce((sum, i) => sum + (Number(i.total_price) || 0), 0);
    const paid = (paymentMap.get(order.id) || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const value = document.createElement("div"); value.className = "dashboard-order-value"; value.innerHTML = `<strong>${formatPrice(total)}</strong><span>${paid >= total - 0.005 ? "Paid" : `${formatPrice(Math.max(0, total-paid))} due`}</span>`;
    button.append(name, value); button.addEventListener("click", () => { currentOrderId = order.id; currentOrderShowProduction = false; navigate("order-detail"); });
    list.appendChild(button);
  });
}

async function loadOrders(prefilter = null) {
  const user = await getCurrentUser();
  const cacheKey = `orders-list:${user.id}`;
  let snapshot = null;
  if (!runtimeOffline && navigator.onLine) {
    try {
      const [ordersResult, paymentsResult] = await Promise.all([
        supabase.from("orders").select(`id,order_number,created_at,cancelled_at,event_id,fulfillment_type,pickup_status,handed_over_at,customers(id,name,phone),order_items(id,product_name,quantity,total_price,workflow_snapshot,cancelled_at,stage_logs(id,stage_order,action,occurred_at))`).eq("seller_id", user.id).order("created_at", { ascending: false }).limit(200),
        supabase.from("payments").select("id,order_id,amount,payment_type,proof_status,created_at").eq("seller_id", user.id).order("created_at", { ascending: false }).limit(1000)
      ]);
      if (ordersResult.error) throw ordersResult.error;
      if (paymentsResult.error) throw paymentsResult.error;
      snapshot = { orders: ordersResult.data || [], payments: paymentsResult.data || [], cachedAt: Date.now() };
      await cacheNamed(cacheKey, snapshot);
    } catch (error) {
      snapshot = await getCachedSnapshot(cacheKey);
      if (!snapshot) throw error;
    }
  } else { snapshot = await getCachedSnapshot(cacheKey); }
  snapshot = snapshot || { orders: [], payments: [] };
  window.__ordeliOrdersSnapshot = snapshot;
  renderOrdersList(prefilter || window.__ordeliOrdersFilter || "all");
}

function renderOrdersList(filter) {
  window.__ordeliOrdersFilter = filter;
  const snapshot = window.__ordeliOrdersSnapshot || { orders: [], payments: [] };
  const search = ($( "ordersSearch")?.value || "").trim().toLowerCase();
  document.querySelectorAll("[data-orders-filter]").forEach(btn => btn.classList.toggle("is-active", btn.dataset.ordersFilter === filter));
  const paymentsByOrder = new Map();
  snapshot.payments.forEach(p => paymentsByOrder.set(p.order_id, [...(paymentsByOrder.get(p.order_id)||[]), p]));
  const filtered = snapshot.orders.filter(order => {
    const items = (order.order_items || []).filter(i => !i.cancelled_at);
    const cancelled = Boolean(order.cancelled_at) || (order.order_items || []).every(i => i.cancelled_at);
    const productionComplete = items.length > 0 && items.every(isItemProductionComplete);
    const total = items.reduce((sum,i)=>sum+(Number(i.total_price)||0),0);
    const paid = (paymentsByOrder.get(order.id)||[]).reduce((sum,p)=>sum+(Number(p.amount)||0),0);
    const pendingProof = (paymentsByOrder.get(order.id)||[]).some(p => p.proof_status === "pending_verification");
    const fullyPaid = paid >= total - 0.005;
    const ready = productionComplete && fullyPaid && !order.handed_over_at && !cancelled;
    const matchesSearch = !search || String(order.order_number).includes(search) || String(order.customers?.name || "").toLowerCase().includes(search);
    if (!matchesSearch) return false;
    if (filter === "production") return !productionComplete && !cancelled;
    if (filter === "payments") return pendingProof;
    if (filter === "ready") return ready;
    if (filter === "completed") return (productionComplete && (order.handed_over_at || order.fulfillment_type === "courier") && !cancelled);
    if (filter === "cancelled") return cancelled;
    return true;
  });
  $("ordersSummary").textContent = `${filtered.length} order${filtered.length === 1 ? "" : "s"}`;
  const list = $("ordersList"); list.replaceChildren(); $("ordersEmptyState").hidden = filtered.length > 0;
  filtered.forEach(order => list.appendChild(createOrderListCard(order, paymentsByOrder.get(order.id)||[])));
}

function createOrderListCard(order, payments) {
  const card = document.createElement("article"); card.className = "seller-order-card";
  const header = document.createElement("div"); header.className = "seller-order-card-header";
  const title = document.createElement("div");
  const h = document.createElement("h2"); h.textContent = `#${order.order_number}`;
  const customer = document.createElement("p"); customer.textContent = order.customers?.name || "Customer"; title.append(h, customer);
  const badge = document.createElement("span"); badge.className = "order-status-badge"; badge.textContent = order.cancelled_at ? "Cancelled" : orderProductionLabel(order);
  header.append(title,badge); card.appendChild(header);
  const itemText = (order.order_items || []).map(i => `${i.product_name} × ${i.quantity}`).join(" · ");
  const items = document.createElement("p"); items.className = "seller-order-items"; items.textContent = itemText || "No active items"; card.appendChild(items);
  const total = (order.order_items || []).filter(i=>!i.cancelled_at).reduce((s,i)=>s+(Number(i.total_price)||0),0);
  const paid = payments.reduce((s,p)=>s+(Number(p.amount)||0),0);
  const footer = document.createElement("div"); footer.className = "seller-order-card-footer"; footer.innerHTML = `<span>${formatPrice(total)} · ${paid >= total - 0.005 ? "Fully paid" : `${formatPrice(Math.max(0,total-paid))} remaining`}</span>`;
  const open = document.createElement("button"); open.type="button"; open.textContent="Open Order"; open.addEventListener("click",()=>{currentOrderId=order.id;currentOrderShowProduction=false;navigate("order-detail")});
  footer.appendChild(open); card.appendChild(footer); return card;
}

async function loadEvents() {
  const user = await getCurrentUser();
  const cacheKey = `events:${user.id}`;
  let events = null;
  if (!runtimeOffline && navigator.onLine) {
    try {
      const result = await supabase.from("events").select("id,name,location,event_date,start_time,end_time,notes,status").eq("seller_id", user.id).gte("event_date", new Date().toISOString().slice(0,10)).order("event_date", {ascending:true}).order("start_time", {ascending:true});
      if (result.error) throw result.error; events = result.data || []; await cacheNamed(cacheKey,events);
    } catch (error) { events = await getCachedSnapshot(cacheKey); if (!events) throw error; }
  } else events = await getCachedSnapshot(cacheKey);
  events = events || []; const list=$("eventsList"); list.replaceChildren(); $("eventsEmptyState").hidden = events.length>0;
  events.forEach(event => { const card=document.createElement("article"); card.className="event-card"; const date=document.createElement("div"); date.className="event-date-box"; date.innerHTML=`<strong>${new Intl.DateTimeFormat("en-PH",{month:"short",day:"numeric"}).format(new Date(`${event.event_date}T00:00:00`))}</strong><span>${event.status || "Upcoming"}</span>`; const body=document.createElement("div"); const title=document.createElement("h2"); title.textContent=event.name; const meta=document.createElement("p"); meta.textContent=`${event.location} · ${event.start_time ? event.start_time.slice(0,5) : ""}${event.end_time ? `–${event.end_time.slice(0,5)}` : ""}`; body.append(title,meta); card.append(date,body); list.appendChild(card); });
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


  if (!logoPath || !navigator.onLine || runtimeOffline) {
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
// DASHBOARD / ORDERS / EVENTS
// ============================================================

$("homeOrdersButton")?.addEventListener("click", () => navigate("orders"));
$("homeViewOrdersButton")?.addEventListener("click", () => navigate("orders"));
$("homeProductsButton")?.addEventListener("click", () => navigate("products"));
$("homeQrButton")?.addEventListener("click", () => navigate("qr"));
$("homeEventsButton")?.addEventListener("click", () => navigate("events"));
$("ordersBackButton")?.addEventListener("click", () => navigate("home"));
$("ordersScanButton")?.addEventListener("click", () => navigate("scanner"));
$("eventsBackButton")?.addEventListener("click", () => navigate("home"));
document.querySelectorAll("[data-dashboard-route]").forEach(button => {
  button.addEventListener("click", () => {
    const route = button.dataset.dashboardRoute;
    if (route === "orders") { window.__ordeliOrdersFilter = button.dataset.dashboardFilter || "all"; navigate("orders"); }
    else navigate(route);
  });
});
document.querySelectorAll("[data-orders-filter]").forEach(button => button.addEventListener("click", () => renderOrdersList(button.dataset.ordersFilter)));
$("ordersSearch")?.addEventListener("input", () => renderOrdersList(window.__ordeliOrdersFilter || "all"));

// ============================================================
// PRODUCTS
// ============================================================

async function loadProducts() {

  const list = $("productList");
  list.replaceChildren();
  $("emptyProductsState").hidden = true;
  $("productEditor").hidden = true;

  const user = await getCurrentUser();
  const cacheKey = `products:${user.id}`;
  let data = null;

  if (!runtimeOffline && navigator.onLine) {
    try {
      const result = await supabase
        .from("products")
        .select(`
          id, seller_id, name, default_price,
          customer_cancellable_until_stage, is_active,
          created_at, updated_at
        `)
        .eq("seller_id", user.id)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (result.error) throw result.error;
      data = result.data || [];
      await cacheNamed(cacheKey, data);
    } catch (error) {
      data = await getCachedSnapshot(cacheKey);
      if (data == null) throw error;
      console.warn("Using cached products while offline.");
    }
  } else {
    data = await getCachedSnapshot(cacheKey);
  }

  data = data || [];
  if (getRoute() !== "products") return;
  if (!data.length) { $("emptyProductsState").hidden = false; return; }
  const fragment = document.createDocumentFragment();
  data.forEach(product => fragment.appendChild(createProductCard(product)));
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

  $("stageList").innerHTML = "";
  $("emptyStagesState").hidden = true;
  const user = await getCurrentUser();
  const productKey = `workflow-product:${workflowProductId}`;
  const stagesKey = `workflow-stages:${workflowProductId}`;
  let product = null;
  let stages = null;

  if (!runtimeOffline && navigator.onLine) {
    try {
      const productResult = await supabase.from("products").select("id,name").eq("id", workflowProductId).eq("seller_id", user.id).single();
      if (productResult.error) throw productResult.error;
      product = productResult.data;
      const stagesResult = await supabase.from("production_stages").select("id,name,stage_order").eq("product_id", workflowProductId).order("stage_order", { ascending: true });
      if (stagesResult.error) throw stagesResult.error;
      stages = stagesResult.data || [];
      await cacheNamed(productKey, product);
      await cacheNamed(stagesKey, stages);
    } catch (error) {
      product = await getCachedSnapshot(productKey);
      stages = await getCachedSnapshot(stagesKey);
      if (!product || stages == null) throw error;
      console.warn("Using cached workflow while offline.");
    }
  } else {
    product = await getCachedSnapshot(productKey);
    stages = await getCachedSnapshot(stagesKey);
  }

  if (!product) throw new Error("This product is not available offline yet.");
  stages = stages || [];
  workflowProductName = product.name;
  $("workflowProductName").textContent = product.name;
  workflowStages = stages.map(stage => ({ id: stage.id, name: stage.name, stage_order: stage.stage_order }));
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
  const cacheKey = `qr-products:${user.id}`;
  let data = null;
  if (!runtimeOffline && navigator.onLine) {
    try {
      const result = await supabase.from("products").select("id,name,is_active").eq("seller_id", user.id).eq("is_active", true).order("name", {ascending:true});
      if (result.error) throw result.error;
      data = result.data || [];
      await cacheNamed(cacheKey, data);
    } catch (error) {
      data = await getCachedSnapshot(cacheKey);
      if (data == null) throw error;
    }
  } else {
    data = await getCachedSnapshot(cacheKey);
  }
  qrProducts = data || [];
  qrProducts.forEach(product => { const option=document.createElement("option"); option.value=product.id; option.textContent=product.name; select.appendChild(option); });
}


async function loadQrSeries() {

  const list = $("qrSeriesList");
  list.replaceChildren();
  $("emptyQrState").hidden = true;
  const user = await getCurrentUser();
  const cacheKey = `qr-series:${user.id}`;
  let snapshot = null;

  if (!runtimeOffline && navigator.onLine) {
    try {
      let reservationRows = [];
      try {
        const { data: reservations, error: reservationError } = await supabase.from("offline_qr_reservations").select("qr_code_id, device_id, qr_codes(product_id,series_name)").eq("seller_id", user.id);
        if (!reservationError) reservationRows = reservations || [];
      } catch (_) {}
      const { data, error } = await supabase.from("qr_codes").select(`id,product_id,series_name,series_sequence,code,status,created_at,products(name)`).eq("seller_id", user.id).order("created_at", { ascending:false });
      if (error) throw error;
      snapshot = { data: data || [], reservationRows };
      await cacheNamed(cacheKey, snapshot);
    } catch (error) {
      snapshot = await getCachedSnapshot(cacheKey);
      if (!snapshot) throw error;
      console.warn("Using cached QR inventory while offline.");
    }
  } else {
    snapshot = await getCachedSnapshot(cacheKey);
  }

  const data = snapshot?.data || [];
  const reservationRows = snapshot?.reservationRows || [];
  if (getRoute() !== "qr") return;
  const groups = new Map();
  data.forEach(qr => {
    const key = `${qr.product_id}::${qr.series_name}`;
    if (!groups.has(key)) {
      groups.set(key, {
        productId: qr.product_id,
        productName: qr.products?.name || "Product",
        seriesName: qr.series_name || "Unnamed Series",
        total: 0,
        available: 0,
        assigned: 0,
        revoked: 0,
        reserved: 0,
        reservedByDevice: 0
      });
    }
    const group = groups.get(key);
    group.total += 1;
    if (qr.status === "available") group.available += 1;
    else if (qr.status === "assigned") group.assigned += 1;
    else if (qr.status === "revoked") group.revoked += 1;
  });
  reservationRows.forEach(reservation => {
    const key = `${reservation.qr_codes?.product_id}::${reservation.qr_codes?.series_name}`;
    const group = groups.get(key);
    if (!group) return;
    group.reserved += 1;
    if (reservation.device_id === getOfflineDeviceId()) group.reservedByDevice += 1;
  });
  if (!groups.size) { $("emptyQrState").hidden = false; return; }
  const fragment = document.createDocumentFragment();
  groups.forEach(group => fragment.appendChild(createQrSeriesCard(group)));
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

      pendingAddToOrderId =
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


    if (!navigator.onLine) {
      const cached = await getOfflineQr(token);
      if (!cached || cached.used) {
        throw new Error("This QR is not reserved and available for offline use on this device.");
      }
      await stopQrScanner();
      if (pendingAddToOrderId) {
        prepareOrderCreation({ public_token: cached.public_token, products: cached.product }, { addToOrderId: pendingAddToOrderId });
      } else {
        prepareOrderCreation({ public_token: cached.public_token, products: cached.product }, { addToOrderId: null });
      }
      navigate("order-create");
      return;
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

    try {
      const { data: reservation } = await supabase
        .from("offline_qr_reservations")
        .select("qr_code_id,device_id")
        .eq("qr_code_id", qr.id)
        .eq("seller_id", user.id)
        .eq("device_id", getOfflineDeviceId())
        .maybeSingle();
      if (reservation) {
        await putOfflineQrRecords([{
          public_token: qr.public_token,
          qr_code_id: qr.id,
          product_id: qr.product_id,
          code: qr.code,
          status: qr.status,
          product: qr.products || null,
          device_id: getOfflineDeviceId(),
          used: false,
          cachedAt: Date.now()
        }]);
      }
    } catch (_) {}


    if (
      qr.status ===
      "available"
    ) {

      prepareOrderCreation(
        qr,
        { addToOrderId: pendingAddToOrderId }
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
      if (pendingAddToOrderId) {
        throw new Error("That QR is already assigned. Scan an available QR to add another item to this order.");
      }

      currentOrderId =
        await getOrderIdFromItem(
          qr.order_item_id
        );
      currentOrderShowProduction = true;
      try {
        sessionStorage.setItem(`ordeli-order-detail-mode:${currentOrderId}`, "assigned");
      } catch (_) {}

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

function clearOrderDraftStorage() {
  try { sessionStorage.removeItem("ordeli-pending-order-draft"); } catch (_) {}
}

function resetOrderCreateForm() {
  const form = $("orderCreateForm");
  if (form) form.reset();
  if ($("newCustomerChoice")) $("newCustomerChoice").checked = true;
  if ($("existingCustomerChoice")) $("existingCustomerChoice").checked = false;
  if ($("orderQuantity")) $("orderQuantity").value = "1";
  if ($("orderDownpayment")) $("orderDownpayment").value = "0";
  if ($("existingCustomerSelect")) $("existingCustomerSelect").value = "";
  clearOrderMessage();
}

function persistPendingOrderDraft() {
  try {
    sessionStorage.setItem("ordeli-pending-order-draft", JSON.stringify({
      qrToken: pendingQrToken,
      product: pendingProduct,
      addToOrderId: pendingAddToOrderId,
      customerChoice: $("existingCustomerChoice")?.checked ? "existing" : "new",
      customerName: $("orderCustomerName")?.value || "",
      customerPhone: $("orderCustomerPhone")?.value || "",
      existingCustomerId: $("existingCustomerSelect")?.value || "",
      quantity: $("orderQuantity")?.value || "1",
      downpayment: $("orderDownpayment")?.value || "0"
    }));
  } catch (_) {}
}

function restorePendingOrderDraft() {
  try {
    const raw = sessionStorage.getItem("ordeli-pending-order-draft");
    if (!raw) return false;
    const draft = JSON.parse(raw);
    if (!draft?.qrToken || !draft?.product) return false;
    pendingQrToken = draft.qrToken;
    pendingProduct = draft.product;
    pendingAddToOrderId = draft.addToOrderId || null;
    $("orderDetectedProduct").textContent = pendingProduct?.name || "Product";
    $("orderDetectedPrice").textContent = formatPrice(pendingProduct?.default_price);
    if ($("orderCustomerName")) $("orderCustomerName").value = draft.customerName || "";
    if ($("orderCustomerPhone")) $("orderCustomerPhone").value = draft.customerPhone || "";
    if ($("existingCustomerSelect")) $("existingCustomerSelect").value = draft.existingCustomerId || "";
    if ($("orderQuantity")) $("orderQuantity").value = draft.quantity || "1";
    if ($("orderDownpayment")) $("orderDownpayment").value = draft.downpayment || "0";
    if (!pendingAddToOrderId && draft.customerChoice === "existing") $("existingCustomerChoice").checked = true;
    updateOrderCreateMode();
    toggleCustomerChoice();
    updateOrderCreateTotals();
    if (!pendingAddToOrderId) loadActiveCustomers();
    return true;
  } catch (_) {
    return false;
  }
}

function updateOrderCreateMode() {
  const addingItem = Boolean(pendingAddToOrderId);
  const customerChoice = document.querySelector('.customer-choice');
  const newFields = $('newCustomerFields');
  const existingFields = $('existingCustomerFields');
  const customerName = $('orderCustomerName');
  const customerPhone = $('orderCustomerPhone');
  const customerSelect = $('existingCustomerSelect');

  if (addingItem) {
    // Adding an item is NOT a new transaction. Keep the customer context
    // inherited from the currently-open order and remove all customer-choice UI.
    if (customerChoice) customerChoice.hidden = true;
    if (newFields) newFields.hidden = true;
    if (existingFields) existingFields.hidden = true;
    if (customerName) { customerName.required = false; customerName.disabled = true; }
    if (customerPhone) { customerPhone.required = false; customerPhone.disabled = true; }
    if (customerSelect) customerSelect.disabled = true;
  } else {
    if (customerChoice) customerChoice.hidden = false;
    if (newFields) newFields.hidden = false;
    if (existingFields) existingFields.hidden = true;
    if (customerName) { customerName.disabled = false; }
    if (customerPhone) { customerPhone.disabled = false; }
    if (customerSelect) customerSelect.disabled = false;
    customerName.required = !($('existingCustomerChoice')?.checked);
  }

  $('orderCreateScreen').querySelector('h1').textContent = addingItem ? 'Add Item to Order' : 'Create Order';
  const subtitle = $('orderCreateScreen').querySelector('.page-subtitle');
  if (subtitle) subtitle.textContent = addingItem
    ? 'Adding this product to the same customer and order.'
    : 'The scanned QR has already identified the product.';

  let context = $('addToOrderContext');
  if (addingItem && !context) {
    context = document.createElement('div');
    context.id = 'addToOrderContext';
    context.className = 'add-to-order-context';
    const card = $('orderCreateForm');
    card?.insertBefore(context, card.firstElementChild?.nextElementSibling || card.firstElementChild);
  }
  if (!addingItem && context) context.remove();
}

async function renderAddToOrderContext() {
  const container = $("addToOrderContext");
  if (!container || !pendingAddToOrderId) return;
  container.textContent = "Loading current customer…";
  let order = await getCachedSnapshot(`order:${pendingAddToOrderId}`);
  if (!order && navigator.onLine && !runtimeOffline) {
    try {
      const user = await getCurrentUser();
      const result = await supabase.from("orders").select("id,order_number,customer_id,customers(id,name,phone)").eq("id", pendingAddToOrderId).eq("seller_id", user.id).single();
      if (result.error) throw result.error;
      order = result.data;
      await cacheNamed(`order:${pendingAddToOrderId}`, order);
    } catch (_) {}
  }
  const customer = order?.customers;
  container.innerHTML = "";
  const eyebrow = document.createElement("div"); eyebrow.className = "context-eyebrow"; eyebrow.textContent = "CURRENT ORDER";
  const title = document.createElement("strong"); title.textContent = order?.order_number ? `Order #${order.order_number}` : "Current order";
  const name = document.createElement("span"); name.textContent = customer?.name || "Customer";
  const phone = document.createElement("span"); phone.textContent = customer?.phone || "No phone number";
  container.append(eyebrow, title, name, phone);
}

function prepareOrderCreation(qr, { addToOrderId = null } = {}) {
  pendingQrToken = qr.public_token;
  pendingProduct = qr.products;
  pendingAddToOrderId = addToOrderId || pendingAddToOrderId || null;
  resetOrderCreateForm();
  $("orderDetectedProduct").textContent = qr.products?.name || "Product";
  $("orderDetectedPrice").textContent = formatPrice(qr.products?.default_price);
  updateOrderCreateMode();
  toggleCustomerChoice();
  updateOrderCreateTotals();
  if (pendingAddToOrderId) renderAddToOrderContext(); else loadActiveCustomers();
  persistPendingOrderDraft();
}

async function loadActiveCustomers() {
  const select = $('existingCustomerSelect');
  if (!select) return;
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = ''; placeholder.textContent = 'Select customer';
  select.appendChild(placeholder);
  const user = await getCurrentUser().catch(() => null);
  if (!user?.id) return;
  const cacheKey = `customers:${user.id}`;
  let data = null;
  if (!runtimeOffline && navigator.onLine) {
    try {
      // This is intentionally the seller's customer list, not just customers
      // with an in-progress order. "Existing customer" is for a NEW order.
      const result = await supabase
        .from('customers')
        .select('id,name,phone')
        .eq('seller_id', user.id)
        .order('name', { ascending: true });
      if (result.error) throw result.error;
      data = result.data || [];
      await cacheNamed(cacheKey, data);
    } catch (error) {
      data = await getCachedSnapshot(cacheKey);
      if (data == null) console.warn('Customer list unavailable:', error);
    }
  } else {
    data = await getCachedSnapshot(cacheKey);
  }
  (data || []).forEach(customer => {
    const option = document.createElement('option');
    option.value = customer.id;
    option.dataset.phone = customer.phone || '';
    option.textContent = customer.phone ? `${customer.name} · ${customer.phone}` : customer.name;
    select.appendChild(option);
  });
}

function toggleCustomerChoice() {
  const addingItem = Boolean(pendingAddToOrderId);
  if (addingItem) {
    updateOrderCreateMode();
    return;
  }
  const existing = $('existingCustomerChoice')?.checked;
  $('newCustomerFields').hidden = existing;
  $('existingCustomerFields').hidden = !existing;
  $('orderCustomerName').required = !existing;
}

$("newCustomerChoice").addEventListener("change", () => { toggleCustomerChoice(); persistPendingOrderDraft(); });
$("existingCustomerChoice").addEventListener("change", () => { toggleCustomerChoice(); persistPendingOrderDraft(); });

function updateOrderCreateTotals() {
  const price = Number(pendingProduct?.default_price) || 0;
  const quantity = Number($("orderQuantity").value) || 0;
  const total = price * quantity;
  let downpayment = Number($("orderDownpayment").value);
  if (!Number.isFinite(downpayment) || downpayment < 0) downpayment = 0;
  $("orderCreateTotal").textContent = formatPrice(total);
  $("orderCreateBalance").textContent = formatPrice(Math.max(0, total - Math.min(downpayment, total)));
}

$("orderQuantity").addEventListener("input", () => { updateOrderCreateTotals(); persistPendingOrderDraft(); });
$("orderDownpayment").addEventListener("input", () => { updateOrderCreateTotals(); persistPendingOrderDraft(); });
[$("orderCustomerName"), $("orderCustomerPhone"), $("existingCustomerSelect")].filter(Boolean).forEach(field => field.addEventListener("input", persistPendingOrderDraft));

$("orderCreateForm")
  .addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();

      await createOrder();

    }
  );

const orderCancelButton = $("orderCancelButton");
if (orderCancelButton) {
  orderCancelButton.addEventListener("click", () => {
    const addToOrderId = pendingAddToOrderId;
    pendingAddToOrderId = null;
    pendingQrToken = null;
    pendingProduct = null;
    clearOrderDraftStorage();
    resetOrderCreateForm();

    // Cancelling an add-item flow returns to the existing order.
    if (addToOrderId) {
      currentOrderId = addToOrderId;
      currentOrderShowProduction = false;
      navigate("order-detail");
      return;
    }

    // Cancelling a brand-new transaction returns to the scanner.
    currentOrderId = null;
    currentOrderShowProduction = false;
    navigate("scanner");
  });
}


async function createOrderOfflineFallback() {
  const addingItem = Boolean(pendingAddToOrderId);
  const quantity = Number($('orderQuantity').value);
  const downpayment = addingItem ? 0 : (Number($('orderDownpayment').value) || 0);
  if (!pendingQrToken || !pendingProduct) throw new Error('No scanned product QR is selected.');
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Quantity must be at least 1.');

  const cachedQr = await getOfflineQr(pendingQrToken);
  if (!cachedQr || cachedQr.used) throw new Error('This QR is not reserved and available for offline use on this device.');

  let customerId = null;
  let customerName = null;
  let customerPhone = null;
  if (!addingItem) {
    const usingExisting = $('existingCustomerChoice').checked;
    customerId = usingExisting ? $('existingCustomerSelect').value : null;
    customerName = usingExisting
      ? (($('existingCustomerSelect').selectedOptions[0]?.textContent || '').split(' · ')[0].trim())
      : $('orderCustomerName').value.trim();
    customerPhone = usingExisting ? null : ($('orderCustomerPhone').value.trim() || null);
    if (!customerName) throw new Error('Customer name is required.');
    if (usingExisting && !customerId) throw new Error('Select an existing customer.');
  }

  const total = (Number(pendingProduct?.default_price) || 0) * quantity;
  if (!addingItem && (downpayment < 0 || downpayment > total)) throw new Error('Downpayment must be between ₱0 and the order total.');

  if (addingItem) {
    const existingOrderId = pendingAddToOrderId;
    const parentOrder = await getCachedSnapshot(`order:${existingOrderId}`);
    if (!parentOrder) throw new Error('This order is not available offline on this device.');
    const existingItems = (await getCachedSnapshot(`order-items:${existingOrderId}`)) || [];
    const itemId = `offline-item:${crypto?.randomUUID ? crypto.randomUUID() : Date.now()}`;
    const newItem = {
      id: itemId,
      product_name: pendingProduct?.name || 'Product',
      quantity,
      unit_price: Number(pendingProduct?.default_price) || 0,
      total_price: total,
      workflow_snapshot: pendingProduct?.workflow_snapshot || pendingProduct?.production_workflow_snapshot || [],
      cancelled_at: null,
      offline: true
    };
    const row = await enqueueOfflineOrder({
      action: 'add_item',
      orderId: existingOrderId,
      parentClientOrderId: String(existingOrderId).startsWith('offline:') ? String(existingOrderId).slice('offline:'.length) : null,
      qrToken: pendingQrToken,
      quantity,
      product: pendingProduct,
      productName: newItem.product_name,
      unitPrice: newItem.unit_price,
      total
    });
    await cacheNamed(`order-items:${existingOrderId}`, [...existingItems, newItem]);
    await markOfflineQrUsed(pendingQrToken, row.clientOrderId);
    currentOrderId = existingOrderId;
    currentOrderShowProduction = false;
    pendingAddToOrderId = null; pendingQrToken = null; pendingProduct = null;
    clearOrderDraftStorage();
    navigate('order-detail');
    return;
  }

  const row = await enqueueOfflineOrder({
    qrToken: pendingQrToken,
    customerId,
    customerName,
    customerPhone,
    quantity,
    downpayment,
    productName: pendingProduct?.name || 'Product',
    product: pendingProduct || null,
    unitPrice: Number(pendingProduct?.default_price) || 0,
    total
  });
  const offlineOrderId = `offline:${row.clientOrderId}`;
  const offlineOrderNumber = `OFFLINE-${row.clientOrderId.slice(0, 8).toUpperCase()}`;
  await cacheNamed(`order:${offlineOrderId}`, {
    id: offlineOrderId,
    order_number: offlineOrderNumber,
    customer_id: customerId,
    created_at: row.createdAt,
    customers: { id: customerId, name: customerName, phone: customerPhone },
    offline: true,
    sync_status: 'waiting'
  });
  await cacheNamed(`order-items:${offlineOrderId}`, [{
    id: `offline-item:${row.clientOrderId}`,
    product_name: pendingProduct?.name || 'Product',
    quantity,
    unit_price: Number(pendingProduct?.default_price) || 0,
    total_price: total,
    workflow_snapshot: pendingProduct?.workflow_snapshot || pendingProduct?.production_workflow_snapshot || [],
    cancelled_at: null,
    offline: true
  }]);
  await cacheNamed(`order-payments:${offlineOrderId}`, downpayment > 0 ? [{ amount: downpayment, proof_status: null, payment_type: 'downpayment', created_at: row.createdAt }] : []);
  await markOfflineQrUsed(pendingQrToken, row.clientOrderId);
  currentOrderId = offlineOrderId;
  currentOrderShowProduction = false;
  pendingAddToOrderId = null;
  pendingQrToken = null;
  pendingProduct = null;
  clearOrderDraftStorage();
  await updateConnectivityIndicator();
  navigate('order-detail');
}

async function createOrder() {
  clearOrderMessage();
  if (!pendingQrToken || !pendingProduct) { $("orderCreateMessage").textContent = "No scanned product QR is selected."; return; }

  const quantity = Number($("orderQuantity").value);
  const downpayment = Number($("orderDownpayment").value) || 0;
  const total = (Number(pendingProduct.default_price) || 0) * quantity;
  if (!Number.isInteger(quantity) || quantity < 1) { $("orderCreateMessage").textContent = "Quantity must be at least 1."; return; }
  if (downpayment < 0 || downpayment > total) { $("orderCreateMessage").textContent = "Downpayment must be between ₱0 and the order total."; return; }

  const addingItem = Boolean(pendingAddToOrderId);
  const usingExisting = $("existingCustomerChoice").checked;
  let customerId = null, customerName = null, customerPhone = null;

  if (!addingItem) {
    if (usingExisting) {
      customerId = $("existingCustomerSelect").value;
      if (!customerId) { $("orderCreateMessage").textContent = "Select an active customer."; return; }
      customerName = ($("existingCustomerSelect").selectedOptions[0]?.textContent || "").split(" · ")[0].trim();
    } else {
      customerName = $("orderCustomerName").value.trim();
      customerPhone = $("orderCustomerPhone").value.trim() || null;
      if (!customerName) { $("orderCreateMessage").textContent = "Customer name is required."; return; }
    }
  }

  if (runtimeOffline || !navigator.onLine) {
    try {
      await createOrderOfflineFallback();
    } catch (error) {
      $("orderCreateMessage").textContent = error?.message || "Unable to save offline.";
    }
    return;
  }

  setLoading($("orderSaveButton"), addingItem ? "Adding Item…" : "Saving Order…");
  try {
    await ensureSupabase();
    if (addingItem) {
      let serverOrderId = pendingAddToOrderId;
      if (String(serverOrderId).startsWith("offline:")) {
        serverOrderId = await resolveServerOrderId(serverOrderId);
        if (!serverOrderId) {
          // The parent may still be syncing in the background. Queue this item
          // behind the parent instead of blocking the seller's workflow.
          try {
            await createOrderOfflineFallback();
            return;
          } catch (queuedError) {
            throw new Error(queuedError?.message || "This order is still syncing. The new item could not be queued.");
          }
        }
      }
      const { data, error } = await supabase.rpc("add_order_item_online", { p_order_id: serverOrderId, p_qr_public_token: pendingQrToken, p_quantity: quantity, p_device_id: getOfflineDeviceId() });
      if (error) throw error;
      if (!data?.order_item_id) throw new Error("The item was not added to the order.");
      currentOrderId = serverOrderId;
    } else {
      const { data, error } = await supabase.rpc("create_order_from_qr", { p_qr_public_token: pendingQrToken, p_customer_id: customerId, p_customer_name: customerName, p_customer_phone: customerPhone, p_quantity: quantity, p_downpayment: downpayment, p_device_id: getOfflineDeviceId() });
      if (error) throw error;
      if (!data?.order_id) throw new Error("The order was not created.");
      currentOrderId = data.order_id;
      const createdAt = new Date().toISOString();
      await cacheNamed(`order:${currentOrderId}`, { id: data.order_id, order_number: data.order_number || `LOCAL-${String(data.order_id).slice(0, 8).toUpperCase()}`, customer_id: customerId, created_at: createdAt, customers: { id: customerId, name: customerName, phone: customerPhone }, offline: false, sync_status: "synchronized" });
      await cacheNamed(`order-items:${currentOrderId}`, [{ id: `local-item:${data.order_id}`, product_name: pendingProduct?.name || "Product", quantity, unit_price: Number(pendingProduct?.default_price) || 0, total_price: total, workflow_snapshot: pendingProduct?.workflow_snapshot || pendingProduct?.production_workflow_snapshot || [], cancelled_at: null }]);
      await cacheNamed(`order-payments:${currentOrderId}`, downpayment > 0 ? [{ amount: downpayment, proof_status: null, payment_type: "downpayment", created_at: createdAt }] : []);
    }
    currentOrderShowProduction = false;
    pendingAddToOrderId = null; pendingQrToken = null; pendingProduct = null;
    clearOrderDraftStorage();
    try { sessionStorage.setItem(`ordeli-order-detail-mode:${currentOrderId}`, "fresh"); } catch (_) {}
    navigate("order-detail");
  } catch (error) {
    const message = error?.message || (addingItem ? "Unable to add the item." : "Unable to create the order.");
    const connectivityFailure = !navigator.onLine || runtimeOffline || /network|fetch|offline|failed to fetch|load failed|timeout|supabase network/i.test(message);
    if (connectivityFailure) {
      runtimeOffline = true;
      try {
        await createOrderOfflineFallback();
        return;
      } catch (offlineError) {
        $("orderCreateMessage").textContent = offlineError?.message || message;
      }
    } else {
      $("orderCreateMessage").textContent = message;
    }
  } finally {
    resetButton($("orderSaveButton"), "Save Order");
  }
}

$("orderCreateBackButton").addEventListener("click", () => {
  const orderId = pendingAddToOrderId;
  pendingAddToOrderId = null;
  pendingQrToken = null;
  pendingProduct = null;
  clearOrderDraftStorage();
  if (orderId) {
    currentOrderId = orderId;
    currentOrderShowProduction = false;
    navigate("order-detail");
  } else {
    navigate("scanner");
  }
});

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

  currentOrderTotal = 0;
  currentOrderPaid = 0;
  $("orderDetailItems").replaceChildren();
  $("orderDetailMessage").textContent = "";
  const session = await getSession().catch(() => null);
  const user = session?.user || null;
  const orderKey = `order:${orderId}`;
  const itemsKey = `order-items:${orderId}`;
  const paymentsKey = `order-payments:${orderId}`;
  try {
    const savedMode = sessionStorage.getItem(`ordeli-order-detail-mode:${orderId}`);
    if (savedMode) currentOrderShowProduction = savedMode === "assigned";
  } catch (_) {}
  let order = null, items = null, payments = null;

  if (!runtimeOffline && navigator.onLine && user?.id) {
    try {
      const orderResult = await supabase.from("orders").select(`id,order_number,customer_id,created_at,customers(id,name,phone)`).eq("id", orderId).eq("seller_id", user.id).single();
      if (orderResult.error) throw orderResult.error;
      order = orderResult.data;
      const itemsResult = await supabase.from("order_items").select(`id,product_name,quantity,unit_price,total_price,workflow_snapshot,cancelled_at`).eq("order_id", orderId).eq("seller_id", user.id).order("created_at", {ascending:true});
      if (itemsResult.error) throw itemsResult.error;
      items = itemsResult.data || [];
      const paymentsResult = await supabase.from("payments").select("amount,proof_status").eq("order_id", orderId).eq("seller_id", user.id);
      if (paymentsResult.error) throw paymentsResult.error;
      payments = paymentsResult.data || [];
      await cacheNamed(orderKey, order);
      await cacheNamed(itemsKey, items);
      await cacheNamed(paymentsKey, payments);
    } catch (error) {
      order = await getCachedSnapshot(orderKey);
      items = await getCachedSnapshot(itemsKey);
      payments = await getCachedSnapshot(paymentsKey);
      if (!order || items == null || payments == null) throw error;
      console.warn("Using cached order details while offline.");
    }
  } else {
    order = await getCachedSnapshot(orderKey);
    items = await getCachedSnapshot(itemsKey);
    payments = await getCachedSnapshot(paymentsKey);
  }

  if (!order) {
    throw new Error("This order could not be loaded. Please reconnect to the internet and try again.");
  }
  items = items || [];
  payments = payments || [];
  $("orderDetailTitle").textContent = `Order #${order.order_number}`;
  $("orderDetailNumber").textContent = `#${order.order_number}`;
  $("orderDetailCustomerName").textContent = order.customers?.name || "Customer";
  $("orderDetailCustomer").textContent = order.customers?.phone || "";

  let total = 0;
  items.forEach(item => {
    total += Number(item.total_price) || 0;
    const row = document.createElement("div");
    row.className = "order-detail-item";
    const left = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = item.product_name;
    const qty = document.createElement("span"); qty.textContent = ` × ${item.quantity}`;
    left.append(name, qty);
    const price = document.createElement("strong"); price.textContent = formatPrice(item.total_price);
    row.append(left, price);
    if (item.cancelled_at) row.classList.add("is-cancelled");
    if (currentOrderShowProduction) {
      const productionPanel = document.createElement("section");
      productionPanel.className = "production-panel";
      renderProductionPanel(item, productionPanel);
      $("orderDetailItems").append(row, productionPanel);
    } else {
      $("orderDetailItems").append(row);
    }
  });

  const paid = payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  $("orderDetailTotal").textContent = formatPrice(total);
  $("orderDetailPaid").textContent = formatPrice(paid);
  currentOrderTotal = total;
  currentOrderPaid = paid;
  $("orderDetailBalance").textContent = formatPrice(Math.max(0, total - paid));
  await loadPayments(orderId);
}


function clearOrderDetailScreen() {
  currentOrderTotal = 0;
  currentOrderPaid = 0;
  ["orderDetailTitle","orderDetailNumber","orderDetailCustomerName","orderDetailCustomer","orderDetailTotal","orderDetailPaid","orderDetailBalance"].forEach(id => { if ($(id)) $(id).textContent = ""; });
  if ($("orderDetailItems")) $("orderDetailItems").replaceChildren();
  if ($("orderDetailMessage")) $("orderDetailMessage").textContent = "";
}

function startNewTransaction() {
  clearOrderDetailScreen();
  currentOrderId = null;
  currentOrderShowProduction = false;
  pendingAddToOrderId = null;
  pendingQrToken = null;
  pendingProduct = null;
  resetOrderCreateForm();
  clearOrderDraftStorage();
  navigate("scanner");
}

// ============================================================
// ORDER DETAIL ACTIONS
// ============================================================

const orderDetailBackButton = $("orderDetailBackButton");
if (orderDetailBackButton) {
  orderDetailBackButton.addEventListener("click", () => {
    currentOrderId = null;
    currentOrderShowProduction = false;
    pendingQrToken = null;
    pendingProduct = null;
    navigate("home");
  });
}

const orderDetailAddItemButton = $("orderDetailAddItemButton");
if (orderDetailAddItemButton) {
  orderDetailAddItemButton.addEventListener("click", () => {
    if (!currentOrderId) return;
    pendingAddToOrderId = currentOrderId;
    pendingQrToken = null;
    pendingProduct = null;
    clearOrderDraftStorage();
    navigate("scanner");
  });
}

const orderDetailNewTransactionButton = $("orderDetailNewTransactionButton");
if (orderDetailNewTransactionButton) {
  orderDetailNewTransactionButton.addEventListener("click", () => {
    startNewTransaction();
  });
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
  if (!runtimeOffline && navigator.onLine) {
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

async function loadPayments(
  orderId
) {

  const list = $("paymentList");
  list.replaceChildren();
  const session = await getSession().catch(() => null);
  const user = session?.user || null;
  const cacheKey = `order-payments-full:${orderId}`;
  let payments = null;
  if (navigator.onLine && user?.id) {
    try {
      const result = await supabase.from("payments").select(`id,amount,payment_type,proof_status,created_at`).eq("order_id", orderId).eq("seller_id", user.id).order("created_at", {ascending:true});
      if (result.error) throw result.error;
      payments = result.data || [];
      await cacheNamed(cacheKey, payments);
    } catch (error) {
      payments = await getCachedSnapshot(cacheKey);
      if (payments == null) {
        payments = await getCachedSnapshot(`order-payments:${orderId}`);
      }
      if (payments == null) throw error;
    }
  } else {
    payments = await getCachedSnapshot(cacheKey);
    if (payments == null) payments = await getCachedSnapshot(`order-payments:${orderId}`);
  }
  payments = payments || [];
  if (!payments.length) {
    const empty = document.createElement("p");
    empty.className = "payment-empty"; empty.textContent = "No payments recorded yet."; list.appendChild(empty); return;
  }
  const fragment = document.createDocumentFragment();
  payments.forEach((payment, index) => {
    const row = document.createElement("div"); row.className = "payment-row";
    const left = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = paymentTypeLabel(payment.payment_type);
    const meta = document.createElement("span"); meta.textContent = formatDate(payment.created_at);
    left.append(title, meta);
    const right = document.createElement("div"); right.className = "payment-row-right";
    const amount = document.createElement("strong"); amount.textContent = formatPrice(payment.amount);
    right.appendChild(amount); row.append(left, right);
    fragment.appendChild(row);
  });
  list.appendChild(fragment);
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

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function paymentTypeLabel(value) {
  const labels = {
    downpayment: "Downpayment",
    additional: "Additional Payment",
    final: "Final Payment",
    cash: "Cash",
    other: "Other"
  };
  return labels[value] || "Payment";
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

    window.__ordeliOrdersSnapshot = null;
    window.__ordeliOrdersFilter = "all";

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

supabase.auth.onAuthStateChange((event, currentSession) => {
  setTimeout(() => {
    if (event === "SIGNED_OUT") {
      showScreen(getRoute() === "register" ? "register" : "login");
      return;
    }
    if (currentSession) renderApplication();
  }, 0);
});


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
