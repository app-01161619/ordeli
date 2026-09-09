import { supabase, readPersistedSession, ensureSupabase } from "./supabase.js";


// ============================================================
// HELPERS
// ============================================================

const $ = (id) =>
  document.getElementById(id);

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

const bootFallback = document.getElementById("bootFallback");
function hideBootFallback() { bootFallback?.classList.add("is-hidden"); }

const EXTERNAL_ASSET_URLS = {
  qrcode: "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
  scanner: "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"
};
const externalAssetPromises = new Map();
async function ensureExternalScript(key) {
  if (key === "qrcode" && typeof QRCode !== "undefined") return true;
  if (key === "scanner" && typeof Html5Qrcode !== "undefined") return true;
  if (externalAssetPromises.has(key)) return externalAssetPromises.get(key);
  const url = EXTERNAL_ASSET_URLS[key];
  if (!url) throw new Error(`Unknown asset: ${key}`);
  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-ordeli-asset="${key}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Unable to load ${key} library.`)), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = url;
    script.async = false;
    script.dataset.ordeliAsset = key;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error(`Unable to load ${key} library. Connect to the internet once to cache this feature for offline use.`));
    document.head.appendChild(script);
  });
  externalAssetPromises.set(key, promise);
  try { return await promise; } catch (error) { externalAssetPromises.delete(key); throw error; }
}

// ============================================================
// OFFLINE / SYNC FOUNDATION
// ============================================================
const OFFLINE_DB_NAME = "ordeli-offline";
const OFFLINE_DB_VERSION = 4;
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
  return row;
}

async function enqueueOfflineProductionStage(payload) {
  const db = await openOfflineDb();
  if (!db) throw new Error("Offline storage is not available on this device.");
  const clientActionId = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const row = {
    type: "finish_production_stage",
    status: "waiting",
    clientActionId,
    clientOrderId: payload?.orderId || null,
    deviceId: getOfflineDeviceId(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    payload
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, "readwrite");
    tx.objectStore(OFFLINE_QUEUE_STORE).add(row);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("Unable to save the production update offline."));
  });
  return row;
}

async function getOfflineQueueRows({ includeFinished = false } = {}) {
  const db = await openOfflineDb();
  if (!db) return [];
  return new Promise(resolve => {
    const request = db.transaction(OFFLINE_QUEUE_STORE, "readonly").objectStore(OFFLINE_QUEUE_STORE).getAll();
    request.onsuccess = () => {
      const rows = (request.result || []).filter(row => ["create_order", "add_order_item", "finish_production_stage"].includes(row.type));
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
    try { await ensureSupabase(); } catch (error) {
      console.warn("Supabase initialization for offline sync failed:", error);
      return;
    }

    let sessionResult = await supabase.auth.getSession();
    let session = sessionResult?.data?.session || null;
    if (!session?.user?.id) {
      try {
        const refreshed = await supabase.auth.refreshSession();
        session = refreshed?.data?.session || null;
      } catch (refreshError) {
        console.warn("Supabase session refresh for offline sync failed:", refreshError);
      }
    }
    if (!session?.user?.id) {
      throw new Error("Your seller session is not available. Reopen the app while online to restore the session, then syncing will resume automatically.");
    }

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
        if (row.type === "finish_production_stage") {
          const p = row.payload || {};
          let uploadedPath = p.proofPath || null;
          if (p.file && uploadedPath) {
            const { error: uploadError } = await supabase.storage.from("production-proofs").upload(uploadedPath, p.file, {
              cacheControl: "3600", upsert: false, contentType: p.file.type
            });
            if (uploadError && !String(uploadError.message || "").toLowerCase().includes("already exists")) throw uploadError;
          }

          let data, error;
          if (p.actorType === "production_member") {
            ({ data, error } = await supabase.rpc("finish_production_stage_member_v2", {
              p_order_item_id: p.orderItemId,
              p_note: p.note || null,
              p_proof_photo_path: uploadedPath
            }));
          } else {
            ({ data, error } = await supabase.rpc("finish_production_stage", {
              p_order_item_id: p.orderItemId,
              p_stage_order: p.stageOrder,
              p_stage_name: p.stageName,
              p_note: p.note || null
            }));
            if (!error && uploadedPath && data?.stage_log_id) {
              const updateResult = await supabase.from("stage_logs").update({ proof_photo_path: uploadedPath }).eq("id", data.stage_log_id).eq("order_item_id", p.orderItemId);
              if (updateResult.error) throw updateResult.error;
            }
          }
          if (error) throw error;
          row.serverResult = data || {};
          if (p.orderId && !String(p.orderId).startsWith("offline:")) {
            try { await reconcileOrderCacheFromServer(p.orderId); } catch (refreshError) { console.warn("Order reconciliation after production sync failed; local state retained.", refreshError); }
          }
        } else if (row.type === "add_order_item") {
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
          const { data, error } = await supabase.rpc("sync_offline_order_v5", {
            p_client_order_id: row.clientOrderId,
            p_device_id: row.deviceId,
            p_qr_public_token: p.qrToken,
            p_customer_id: p.customerId || null,
            p_customer_name: p.customerName || null,
            p_customer_phone: p.customerPhone || null,
            p_quantity: p.quantity,
            p_downpayment: p.downpayment
          });
          if (error) throw new Error(`Order sync failed: ${error.message || JSON.stringify(error)}`);
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
async function showOfflineSyncRecovery() {
  const existing = document.getElementById("offlineSyncRecoveryPanel");
  if (existing) { existing.remove(); return; }

  const rows = await getOfflineQueueRows({ includeFinished: false });
  const errors = rows.filter(row => row.status === "error");
  if (!errors.length) {
    const notice = document.createElement("div");
    notice.className = "sync-recovery-notice";
    notice.textContent = "There are no failed sync actions. Pending work will continue automatically.";
    document.body.appendChild(notice);
    window.setTimeout(() => notice.remove(), 2800);
    return;
  }

  if (!document.getElementById("ordeli-sync-recovery-style")) {
    const style = document.createElement("style");
    style.id = "ordeli-sync-recovery-style";
    style.textContent = `.sync-recovery-panel{position:fixed;z-index:9999;right:16px;bottom:16px;width:min(430px,calc(100vw - 32px));max-height:min(70vh,620px);overflow:auto;background:var(--surface,#fff);color:var(--text,#1f2937);border:1px solid rgba(0,0,0,.12);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.18);padding:16px}.sync-recovery-head,.sync-recovery-actions{display:flex;align-items:center;justify-content:space-between;gap:10px}.sync-recovery-head{margin-bottom:8px}.sync-recovery-panel p{margin:8px 0 12px}.sync-recovery-list{display:grid;gap:8px}.sync-recovery-item{display:grid;gap:3px;padding:10px 12px;border-radius:10px;background:rgba(127,127,127,.08)}.sync-recovery-item span{font-size:.88rem;line-height:1.35;overflow-wrap:anywhere}.sync-recovery-notice{position:fixed;z-index:9999;right:16px;bottom:16px;padding:12px 14px;border-radius:10px;background:var(--surface,#fff);border:1px solid rgba(0,0,0,.12);box-shadow:0 10px 30px rgba(0,0,0,.15)}.connectivity-indicator.is-clickable{cursor:pointer}`;
    document.head.appendChild(style);
  }

  const panel = document.createElement("section");
  panel.id = "offlineSyncRecoveryPanel";
  panel.className = "sync-recovery-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Sync recovery");

  const head = document.createElement("div");
  head.className = "sync-recovery-head";
  const title = document.createElement("strong");
  title.textContent = "Sync needs attention";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "secondary-button";
  close.textContent = "Close";
  close.addEventListener("click", () => panel.remove());
  head.append(title, close);

  const text = document.createElement("p");
  text.textContent = `${errors.length} queued action${errors.length === 1 ? " is" : "s are"} waiting because synchronization failed. You can retry them now.`;

  const list = document.createElement("div");
  list.className = "sync-recovery-list";
  errors.forEach(row => {
    const item = document.createElement("article");
    item.className = "sync-recovery-item";
    const kind = document.createElement("strong");
    kind.textContent = row.type === "finish_production_stage" ? "Production stage" : row.type === "add_order_item" ? "Add order item" : "Create order";
    const detail = document.createElement("span");
    detail.textContent = row.lastError || "Synchronization failed.";
    item.append(kind, detail);
    list.appendChild(item);
  });

  const actions = document.createElement("div");
  actions.className = "sync-recovery-actions";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "primary-button";
  retry.textContent = "Retry Sync";
  retry.addEventListener("click", async () => {
    retry.disabled = true;
    retry.textContent = "Retrying…";
    for (const row of errors) {
      row.status = "waiting";
      row.nextAttemptAt = null;
      await updateQueuedOrder(row);
    }
    panel.remove();
    await updateConnectivityIndicator();
    await syncOfflineOrders();
    await updateConnectivityIndicator();
  });
  actions.appendChild(retry);

  panel.append(head, text, list, actions);
  document.body.appendChild(panel);
}

async function updateConnectivityIndicator() {
  const indicator = ensureConnectivityIndicator();
  const online = navigator.onLine;
  const pending = await getPendingSyncCount();
  indicator.classList.toggle("is-offline", !online);
  indicator.classList.toggle("is-online", online && pending === 0);
  indicator.classList.toggle("has-pending", pending > 0);
  indicator.classList.toggle("is-clickable", pending > 0 && online);
  indicator.onclick = pending > 0 && online ? () => showOfflineSyncRecovery().catch(error => console.warn("Sync recovery panel failed:", error)) : null;
  if (!online) {
    indicator.textContent = pending ? `Offline · ${pending} waiting to sync` : "Offline";
    return;
  }
  if (pending > 0) {
    const rows = await getOfflineQueueRows({ includeFinished: false });
    const firstError = rows.find(row => row.status === "error" && row.lastError)?.lastError || "";
    const friendly = firstError.toLowerCase().includes("reservation")
      ? "Sync needs attention · QR reservation"
      : firstError.toLowerCase().includes("auth") || firstError.toLowerCase().includes("session") || firstError.includes("JWT")
        ? "Sync needs attention · Session"
        : "Sync needs attention";
    indicator.textContent = firstError ? `Sync needs attention · ${pending}` : `Waiting to Sync · ${pending}`;
    return;
  }
  indicator.textContent = "Online";
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
  updateConnectivityIndicator().catch(error => console.warn("Connectivity indicator startup failed:", error));

  supabase.auth.onAuthStateChange((event, session) => {
    if (session?.user?.id && ["SIGNED_IN", "TOKEN_REFRESHED", "INITIAL_SESSION"].includes(event)) {
      scheduleOfflineSync(0);
    }
  });

  window.addEventListener("online", async () => {
    runtimeOffline = false;
    // Mark the runtime online immediately and drain the queue.  Do not wait
    // for a later polling tick.
    await updateConnectivityIndicator();
    // Reinitialize Supabase and immediately reconcile anything that was saved
    // while offline. The seller UI is not reloaded unless it needs it.
    try { await ensureSupabase(); } catch (error) { console.warn("Supabase initialization after reconnect failed:", error); return; }
    try { await refreshOfflineQrCache(); } catch (_) {}
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

  navigator.serviceWorker?.addEventListener("message", (event) => {
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

  memberSignup:
    $("memberSignupScreen"),

  shopSetup:
    $("shopSetupScreen"),

  home:
    $("homeScreen"),

  production:
    $("productionScreen"),

  team:
    $("teamScreen"),

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

  updates:
    $("updatesScreen"),

  reviews:
    $("reviewsScreen"),

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
let productionScannerInstance = null;
let productionScanBusy = false;


// ============================================================
// ROUTING
// ============================================================

const validRoutes = [
  "login",
  "register",
  "member-signup",
  "shop-setup",
  "home",
  "production",
  "team",
  "products",
  "workflow",
  "qr",
  "scanner",
  "order-create",
  "order-detail",
  "orders",
  "events",
  "updates",
  "reviews"
];


function getRoute() {

  const raw =
    window.location.hash
      .replace(/^#/, "")
      .toLowerCase();

  if (raw.startsWith("member-signup/")) return "member-signup";

  return validRoutes.includes(raw)
    ? raw
    : "login";

}

function getMemberInviteToken() {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw.toLowerCase().startsWith("member-signup/")) return "";
  try { return decodeURIComponent(raw.slice("member-signup/".length)).trim(); }
  catch (_) { return raw.slice("member-signup/".length).trim(); }
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
// ACTOR / ROLE
// ============================================================

let actorContextCache = null;

async function getActorContext(force = false) {
  if (actorContextCache && !force) return actorContextCache;
  if (!navigator.onLine || runtimeOffline) {
    try {
      const raw = localStorage.getItem("ordeli-actor-context");
      if (raw) actorContextCache = JSON.parse(raw);
    } catch (_) {}
    return actorContextCache;
  }

  await ensureSupabase();
  const session = await getSession();
  const user = session?.user;
  if (!user) return null;

  try {
    const { data: member, error: memberError } = await supabase
      .from("production_members")
      .select("id,seller_id,name,email,section_label,role,can_view_production,can_scan_qr,can_finish_stage,can_upload_proof,is_active,invite_status")
      .eq("auth_user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!memberError && member) {
      actorContextCache = {
        actor_type: "production_member",
        user_id: user.id,
        seller_id: member.seller_id,
        member_id: member.id,
        name: member.name,
        email: member.email || user.email || null,
        section_label: member.section_label,
        role: member.role || "production_member",
        can_view_production: member.can_view_production !== false,
        can_scan_qr: member.can_scan_qr !== false,
        can_finish_stage: member.can_finish_stage !== false,
        can_upload_proof: member.can_upload_proof !== false
      };
      try { localStorage.setItem("ordeli-actor-context", JSON.stringify(actorContextCache)); } catch (_) {}
      return actorContextCache;
    }
  } catch (error) {
    console.warn("Production-member lookup failed:", error);
  }

  const { data, error } = await supabase.rpc("get_current_actor");
  if (error) throw error;
  actorContextCache = data || null;
  try { localStorage.setItem("ordeli-actor-context", JSON.stringify(actorContextCache)); } catch (_) {}
  return actorContextCache;
}

function isProductionMemberActor(actor) {
  return actor?.actor_type === "production_member";
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

  hideBootFallback();
  if (renderInFlight) {
    return renderInFlight;
  }

  renderInFlight =
    (async () => {


  try {

    if (!runtimeOffline && navigator.onLine) {
      try { await ensureSupabase(); } catch (_) {}
    }

    const route = getRoute();

    if (route === "member-signup") {
      showScreen("memberSignup");
      await prepareMemberSignupScreen();
      return;
    }

    const session =
      await getSession();


    if (!session) {

      showScreen(
        route ===
          "register"
          ? "register"
          : "login"
      );

      return;

    }

    let actor = null;
    try { actor = await getActorContext(); } catch (_) {}

    // A production member must never fall through to seller/shop onboarding.
    // The linked production_members.auth_user_id is the authoritative role
    // fallback when the actor RPC is unavailable, stale, or not yet refreshed.
    if (!isProductionMemberActor(actor) && navigator.onLine && !runtimeOffline) {
      try {
        const { data: member, error: memberError } = await supabase
          .from("production_members")
          .select("id,seller_id,name,email,section_label,role,can_view_production,can_scan_qr,can_finish_stage,can_upload_proof,is_active,invite_status")
          .eq("auth_user_id", session.user.id)
          .eq("is_active", true)
          .maybeSingle();
        if (!memberError && member) {
          actor = {
            actor_type: "production_member",
            member_id: member.id,
            seller_id: member.seller_id,
            name: member.name,
            email: member.email,
            section_label: member.section_label,
            role: member.role || "production_member",
            can_view_production: member.can_view_production,
            can_scan_qr: member.can_scan_qr,
            can_finish_stage: member.can_finish_stage,
            can_upload_proof: member.can_upload_proof
          };
          actorContextCache = actor;
          try { localStorage.setItem("ordeli-actor-context", JSON.stringify(actor)); } catch (_) {}
        }
      } catch (_) {}
    }

    if (isProductionMemberActor(actor)) {
      if (getRoute() !== "production") navigate("production");
      showScreen("production");
      await renderProductionWork(actor);
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


    if (getRoute() === "production") {
      showScreen("production");
      await renderProductionWork(await getActorContext(true));
      return;
    }

    if (getRoute() === "team") {
      showScreen("team");
      await renderTeam();
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

    if (getRoute() === "updates") {
      showScreen("updates");
      await loadSmsUpdates();
      return;
    }

    if (getRoute() === "reviews") {
      showScreen("reviews");
      await loadReviews();
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
      let updates = [];
      try {
        const updatesResult = await supabase.from("sms_update_drafts")
          .select("id,order_id,triggered_by_user_id,message_text,status,created_at,sent_marked_at,orders(order_number,customers(name,phone))")
          .eq("seller_id", sellerId)
          .is("sent_marked_at", null)
          .order("created_at", { ascending: false })
          .limit(100);
        if (!updatesResult.error) updates = updatesResult.data || [];
      } catch (_) {}
      snapshot = { orders: ordersResult.data || [], payments: paymentsResult.data || [], events: eventsResult.data || [], updates, cachedAt: Date.now() };
      await cacheNamed(cacheKey, snapshot);
    } catch (error) {
      snapshot = await getCachedSnapshot(cacheKey);
      if (!snapshot) throw error;
    }
  } else {
    snapshot = await getCachedSnapshot(cacheKey);
  }
  snapshot = snapshot || { orders: [], payments: [], events: [], updates: [] };
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
      if (result.error) throw result.error;
      events = result.data || [];
      await cacheNamed(cacheKey, events);
    } catch (error) {
      events = await getCachedSnapshot(cacheKey);
      if (!events) throw error;
    }
  } else {
    events = await getCachedSnapshot(cacheKey);
  }

  events = events || [];
  const list = $("eventsList");
  list.replaceChildren();
  $("eventsEmptyState").hidden = events.length > 0;

  for (const event of events) {
    let orders = [];
    try {
      if (!runtimeOffline && navigator.onLine) {
        const result = await supabase.from("orders")
          .select("id,order_number,pickup_status,handed_over_at,cancelled_at,customers(name),order_items(product_name,quantity,cancelled_at)")
          .eq("seller_id", user.id)
          .eq("event_id", event.id)
          .is("cancelled_at", null)
          .order("created_at", {ascending:true});
        if (!result.error) orders = result.data || [];
      }
    } catch (_) {}

    const card = document.createElement("article");
    card.className = "event-card";
    const date = document.createElement("div");
    date.className = "event-date-box";
    date.innerHTML = `<strong>${new Intl.DateTimeFormat("en-PH",{month:"short",day:"numeric"}).format(new Date(`${event.event_date}T00:00:00`))}</strong><span>${event.status || "Upcoming"}</span>`;

    const body = document.createElement("div");
    const title = document.createElement("h2"); title.textContent = event.name;
    const meta = document.createElement("p");
    const time = `${event.start_time ? event.start_time.slice(0,5) : ""}${event.end_time ? `–${event.end_time.slice(0,5)}` : ""}`;
    meta.textContent = `${event.location}${time ? ` · ${time}` : ""}`;
    body.append(title, meta);

    const summary = document.createElement("div");
    summary.className = "event-order-summary";
    if (!orders.length) {
      summary.textContent = "No orders assigned yet.";
    } else {
      const quantities = new Map();
      orders.forEach(order => (order.order_items || []).forEach(item => {
        if (item.cancelled_at) return;
        quantities.set(item.product_name, (quantities.get(item.product_name) || 0) + Number(item.quantity || 0));
      }));
      const parts = [...quantities.entries()].map(([name, qty]) => `${name} × ${qty}`);
      summary.textContent = `${orders.length} order${orders.length === 1 ? "" : "s"} · ${parts.join(" · ") || "No active items"}`;
    }
    body.appendChild(summary);

    const actions = document.createElement("div");
    actions.className = "event-card-actions";
    const edit = document.createElement("button");
    edit.type = "button"; edit.className = "secondary-button"; edit.textContent = "Edit";
    edit.addEventListener("click", () => openEventEditor(event));
    actions.appendChild(edit);

    const bring = document.createElement("button");
    bring.type = "button"; bring.textContent = "Bring to Event";
    bring.addEventListener("click", () => openEventOrders(event));
    actions.appendChild(bring);

    const reschedule = document.createElement("button");
    reschedule.type = "button"; reschedule.className = "secondary-button"; reschedule.textContent = "Reschedule Event";
    reschedule.addEventListener("click", () => openEventReschedulePicker(event, card));
    reschedule.hidden = ["completed", "cancelled"].includes(String(event.status || "").toLowerCase());
    actions.appendChild(reschedule);

    const statusButton = document.createElement("button");
    statusButton.type = "button";
    statusButton.className = "secondary-button";
    statusButton.textContent = "Change Status";
    statusButton.hidden = ["completed", "cancelled"].includes(String(event.status || "").toLowerCase());
    statusButton.addEventListener("click", () => openEventStatusPicker(event, card, orders));
    actions.appendChild(statusButton);

    card.append(date, body, actions);
    list.appendChild(card);
  }
}

let editingEventId = null;

function updateEventChangeReasonVisibility() {
  const group = $("eventChangeReasonGroup");
  const input = $("eventChangeReason");
  if (!group || !input) return;

  if (!editingEventId) {
    group.hidden = true;
    input.required = false;
    input.value = "";
    return;
  }

  const originalDate = group.dataset.originalDate || "";
  const originalStart = group.dataset.originalStart || "";
  const originalEnd = group.dataset.originalEnd || "";
  const changed = $("eventDate")?.value !== originalDate
    || ($("eventStartTime")?.value || "") !== originalStart
    || ($("eventEndTime")?.value || "") !== originalEnd;

  group.hidden = !changed;
  input.required = changed;
  if (!changed) input.value = "";
}

function openEventEditor(event = null) {
  editingEventId = event?.id || null;
  const form = $("eventForm");
  form.hidden = false;
  $("eventName").value = event?.name || "";
  $("eventLocation").value = event?.location || "";
  $("eventDate").value = event?.event_date || new Date().toISOString().slice(0,10);
  $("eventStartTime").value = event?.start_time?.slice(0,5) || "";
  $("eventEndTime").value = event?.end_time?.slice(0,5) || "";
  $("eventNotes").value = event?.notes || "";
  if ($("eventChangeReason")) {
    $("eventChangeReason").value = "";
    $("eventChangeReason").required = false;
  }
  const reasonGroup = $("eventChangeReasonGroup");
  if (reasonGroup) {
    reasonGroup.dataset.originalDate = event?.event_date || $("eventDate").value || "";
    reasonGroup.dataset.originalStart = event?.start_time?.slice(0,5) || "";
    reasonGroup.dataset.originalEnd = event?.end_time?.slice(0,5) || "";
  }
  updateEventChangeReasonVisibility();
  $("eventEditorMessage").textContent = "";
  $("newEventButton").textContent = event ? "Close Editor" : "Cancel";
}

function closeEventEditor() {
  editingEventId = null;
  $("eventForm").hidden = true;
  $("eventEditorMessage").textContent = "";
  $("newEventButton").textContent = "New Event";
}

async function saveEventForm(event) {
  event.preventDefault();
  const user = await getCurrentUser();
  const payload = {
    seller_id: user.id,
    name: $("eventName").value.trim(),
    location: $("eventLocation").value.trim(),
    event_date: $("eventDate").value,
    start_time: $("eventStartTime").value || null,
    end_time: $("eventEndTime").value || null,
    notes: $("eventNotes").value.trim() || null
  };
  const changeReason = $("eventChangeReason")?.value.trim() || null;
  // A new event does not require a change reason. An existing event only
  // requires one when its schedule (date/start/end) is changed.
  // The existing Supabase schema uses lowercase event status values.
  // Only new events receive the initial status; editing an event must not
  // accidentally reset an existing Ready/Active/Completed/Cancelled state.
  if (!editingEventId) payload.status = "upcoming";
  if (!payload.name || !payload.location || !payload.event_date) {
    $("eventEditorMessage").textContent = "Event name, location, and date are required.";
    return;
  }
  const button = $("saveEventButton");
  setLoading(button, true, "Saving…");
  try {
    if (editingEventId) {
      const beforeResult = await supabase.from("events").select("id,event_date,start_time,end_time").eq("id", editingEventId).eq("seller_id", user.id).single();
      if (beforeResult.error) throw beforeResult.error;
      const result = await supabase.from("events").update(payload).eq("id", editingEventId).eq("seller_id", user.id);
      if (result.error) throw result.error;
      const before = beforeResult.data;
      const scheduleChanged = before.event_date !== payload.event_date || before.start_time !== payload.start_time || before.end_time !== payload.end_time;
      if (scheduleChanged && !changeReason) {
        $("eventEditorMessage").textContent = "Please provide a reason when changing the event schedule.";
        return;
      }
      if (scheduleChanged) {
        const logResult = await supabase.from("event_change_logs").insert({
          event_id: editingEventId,
          original_event_date: before.event_date,
          original_start_time: before.start_time,
          original_end_time: before.end_time,
          new_event_date: payload.event_date,
          new_start_time: payload.start_time,
          new_end_time: payload.end_time,
          reason: changeReason,
          changed_by_user_id: user.id
        });
        if (logResult.error) throw logResult.error;
      }
    } else {
      const result = await supabase.from("events").insert(payload);
      if (result.error) throw result.error;
    }
    const refreshed = await supabase.from("events").select("id,name,location,event_date,start_time,end_time,notes,status").eq("seller_id", user.id).gte("event_date", new Date().toISOString().slice(0,10)).order("event_date", {ascending:true}).order("start_time", {ascending:true});
    if (refreshed.error) throw refreshed.error;
    await cacheNamed(`events:${user.id}`, refreshed.data || []);
    closeEventEditor();
    await loadEvents();
  } catch (error) {
    $("eventEditorMessage").textContent = getAuthError(error);
  } finally {
    resetButton(button, "Save Event");
  }
}

async function updateEventStatus(eventId, status, orders = []) {
  if (!eventId || !status) throw new Error("Event status is required.");
  const normalized = String(status).toLowerCase();
  if (["completed", "cancelled"].includes(normalized) && orders.some(order => !order.handed_over_at && order.pickup_status !== "unclaimed" && !order.cancelled_at)) {
    throw new Error("This event still has active customer orders. Hand them over, mark them unclaimed, or reschedule them before closing the event.");
  }
  const user = await getCurrentUser();
  const result = await supabase.from("events").update({ status: normalized }).eq("id", eventId).eq("seller_id", user.id);
  if (result.error) throw result.error;
}

async function openEventStatusPicker(event, card, orders = []) {
  if (!event?.id || card.querySelector('.event-status-picker')) return;
  const picker = document.createElement('div');
  picker.className = 'event-status-picker';
  const label = document.createElement('label');
  label.textContent = 'Event status';
  const select = document.createElement('select');
  select.className = 'tracking-select';
  const statuses = [
    ['upcoming', 'Upcoming'],
    ['ready', 'Ready'],
    ['active', 'Active'],
    ['completed', 'Completed'],
    ['cancelled', 'Cancelled']
  ];
  statuses.forEach(([value, text]) => {
    const option = document.createElement('option');
    option.value = value; option.textContent = text;
    if (String(event.status || 'upcoming').toLowerCase() === value) option.selected = true;
    select.appendChild(option);
  });
  const message = document.createElement('p');
  message.className = 'form-message';
  message.hidden = true;
  const actions = document.createElement('div');
  actions.className = 'event-card-actions';
  const save = document.createElement('button');
  save.type = 'button'; save.textContent = 'Save Status';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'secondary-button'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => picker.remove());
  actions.append(save, cancel);
  picker.append(label, select, message, actions);
  card.appendChild(picker);

  save.addEventListener('click', async () => {
    save.disabled = true;
    save.textContent = 'Saving…';
    message.hidden = true;
    try {
      const next = select.value;
      if (next === String(event.status || 'upcoming').toLowerCase()) { picker.remove(); return; }
      await updateEventStatus(event.id, next, orders);
      picker.remove();
      await loadEvents();
    } catch (error) {
      message.hidden = false;
      message.textContent = error?.message || 'Unable to change event status.';
      save.disabled = false;
      save.textContent = 'Save Status';
    }
  });
}

async function openEventReschedulePicker(event, card) {
  if (!event?.id || card.querySelector('.event-reschedule-picker')) return;
  const user = await getCurrentUser();
  const picker = document.createElement('div');
  picker.className = 'event-reschedule-picker';
  const label = document.createElement('label');
  label.textContent = 'Move assigned orders to';
  const select = document.createElement('select');
  select.className = 'tracking-select';
  select.innerHTML = '<option value="">Choose a new event</option>';
  const reason = document.createElement('input');
  reason.type = 'text'; reason.maxLength = 300; reason.required = true; reason.setAttribute('aria-required', 'true'); reason.placeholder = 'Reason for rescheduling';
  const actions = document.createElement('div');
  actions.className = 'event-card-actions';
  const save = document.createElement('button');
  save.type = 'button'; save.textContent = 'Move Orders';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'secondary-button'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => picker.remove());
  actions.append(save, cancel);
  picker.append(label, select, reason, actions);
  card.appendChild(picker);

  save.disabled = true;
  try {
    const result = await supabase.from('events')
      .select('id,name,location,event_date,start_time,status')
      .eq('seller_id', user.id)
      .neq('id', event.id)
      .in('status', ['upcoming','ready','active'])
      .gte('event_date', new Date().toISOString().slice(0,10))
      .order('event_date', { ascending: true })
      .order('start_time', { ascending: true });
    if (result.error) throw result.error;
    const options = result.data || [];
    if (!options.length) {
      const none = document.createElement('p'); none.className = 'form-message'; none.textContent = 'No eligible future event is available to move these orders to.';
      picker.insertBefore(none, actions);
      return;
    }
    options.forEach(target => {
      const option = document.createElement('option');
      option.value = target.id;
      const dateText = target.event_date ? new Intl.DateTimeFormat('en-PH',{month:'short',day:'numeric',year:'numeric'}).format(new Date(`${target.event_date}T00:00:00`)) : '';
      const timeText = target.start_time ? ` · ${target.start_time.slice(0,5)}` : '';
      option.textContent = `${target.name} · ${dateText}${timeText}`;
      select.appendChild(option);
    });
    select.addEventListener('change', () => { save.disabled = !select.value; });
    save.addEventListener('click', async () => {
      if (!select.value) return;
      if (!reason.value.trim()) {
        reason.focus();
        return;
      }
      save.disabled = true;
      save.textContent = 'Rescheduling…';
      try {
        const rpc = await supabase.rpc('reschedule_event_orders', {
          p_event_id: event.id,
          p_new_event_id: select.value,
          p_reason: reason.value.trim() || null
        });
        if (rpc.error) throw rpc.error;
        picker.remove();
        await loadEvents();
      } catch (error) {
        save.disabled = false;
        save.textContent = 'Move Orders';
        const message = document.createElement('p');
        message.className = 'form-message';
        message.textContent = error?.message || 'Unable to reschedule this event.';
        const old = picker.querySelector('.event-reschedule-error');
        old?.remove();
        message.classList.add('event-reschedule-error');
        picker.insertBefore(message, actions);
      }
    });
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'form-message';
    message.textContent = error?.message || 'Unable to load eligible events.';
    picker.insertBefore(message, actions);
  } finally {
    save.disabled = !select.value;
  }
}


async function openEventOrders(event) {
  try {
    const user = await getCurrentUser();
    const result = await supabase.from("orders")
      .select("id,order_number,event_id,pickup_status,handed_over_at,cancelled_at,customers(name),order_items(product_name,quantity,cancelled_at)")
      .eq("seller_id", user.id).eq("event_id", event.id).order("order_number", {ascending:true});
    if (result.error) throw result.error;
    const orders = result.data || [];
    const list = $("eventsList");
    list.replaceChildren();
    const back = document.createElement("button"); back.type="button"; back.className="secondary-button"; back.textContent="← Back to Events";
    back.addEventListener("click", loadEvents);
    list.appendChild(back);
    const heading = document.createElement("div"); heading.className="section-heading";
    heading.innerHTML = `<div><h2>${event.name}</h2><p>${event.location} · ${event.event_date}</p></div>`;
    list.appendChild(heading);
    if (!orders.length) {
      const empty = document.createElement("section"); empty.className="empty-state"; empty.innerHTML="<h2>No Orders for This Event</h2><p>Orders assigned by customers will appear here.</p>"; list.appendChild(empty); return;
    }

    const eligibleOrders = orders.filter(order => !order.cancelled_at && !order.handed_over_at && order.pickup_status !== "unclaimed");
    const bulkBar = document.createElement("div");
    bulkBar.className = "event-bulk-actions";
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.id = "eventSelectAll";
    selectAll.disabled = eligibleOrders.length === 0;
    const selectAllLabel = document.createElement("label");
    selectAllLabel.htmlFor = "eventSelectAll";
    selectAllLabel.textContent = "Select all active orders";
    const bulkButton = document.createElement("button");
    bulkButton.type = "button";
    bulkButton.className = "secondary-button";
    bulkButton.textContent = "Mark Selected Unclaimed";
    bulkButton.disabled = true;
    const bulkMessage = document.createElement("p");
    bulkMessage.className = "form-message";
    bulkMessage.setAttribute("role", "status");
    bulkBar.append(selectAll, selectAllLabel, bulkButton, bulkMessage);
    list.appendChild(bulkBar);

    const selected = new Set();
    const updateBulkState = () => {
      bulkButton.disabled = selected.size === 0;
      bulkButton.textContent = selected.size ? `Mark ${selected.size} Unclaimed` : "Mark Selected Unclaimed";
      if (eligibleOrders.length) selectAll.checked = eligibleOrders.every(order => selected.has(order.id));
    };
    selectAll.addEventListener("change", () => {
      eligibleOrders.forEach(order => {
        if (selectAll.checked) selected.add(order.id);
        else selected.delete(order.id);
      });
      document.querySelectorAll("[data-event-order-select]").forEach(input => { input.checked = selected.has(input.dataset.eventOrderSelect); });
      updateBulkState();
    });

    orders.forEach(order => {
      const card = document.createElement("article"); card.className="event-card";
      const body = document.createElement("div");
      const head = document.createElement("div");
      head.className = "event-order-card-head";
      const eligible = !order.cancelled_at && !order.handed_over_at && order.pickup_status !== "unclaimed";
      if (eligible) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.eventOrderSelect = order.id;
        checkbox.setAttribute("aria-label", `Select Order #${order.order_number}`);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(order.id); else selected.delete(order.id);
          updateBulkState();
        });
        head.appendChild(checkbox);
      }
      const title = document.createElement("h2"); title.textContent = `Order #${order.order_number}`;
      head.appendChild(title);
      const customer = document.createElement("p"); customer.textContent = order.customers?.name || "Customer";
      const items = document.createElement("div"); items.className="event-order-summary";
      items.textContent = (order.order_items || []).filter(i=>!i.cancelled_at).map(i=>`${i.product_name} × ${i.quantity}`).join(" · ");
      const state = document.createElement("span");
      state.className = "event-order-state";
      state.textContent = order.cancelled_at ? "Cancelled" : order.handed_over_at ? "Handed Over" : order.pickup_status === "unclaimed" ? "Unclaimed" : "Bring to Event";
      body.append(head, customer, items, state);
      const open = document.createElement("button"); open.type="button"; open.textContent="Open Order"; open.addEventListener("click",()=>{ currentOrderId=order.id; currentOrderShowProduction=false; navigate("order-detail"); });
      card.append(body, open); list.appendChild(card);
    });

    bulkButton.addEventListener("click", async () => {
      if (!selected.size) return;
      if (!window.confirm(`Mark ${selected.size} selected order${selected.size === 1 ? "" : "s"} as unclaimed?`)) return;
      bulkButton.disabled = true;
      selectAll.disabled = true;
      bulkMessage.textContent = "Updating pickup status…";
      try {
        const ids = [...selected];
        for (const orderId of ids) {
          const { error } = await supabase.rpc("update_order_pickup_status", { p_order_id: orderId, p_action: "unclaimed" });
          if (error) throw error;
        }
        bulkMessage.textContent = `${ids.length} order${ids.length === 1 ? "" : "s"} marked unclaimed.`;
        await openEventOrders(event);
      } catch (error) {
        bulkMessage.textContent = error?.message || "Unable to update the selected orders.";
        bulkButton.disabled = selected.size === 0;
        selectAll.disabled = eligibleOrders.length === 0;
      }
    });
  } catch (error) {
    $("eventsMessage").textContent = getAuthError(error);
  }
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
// PRODUCTION MEMBER ONBOARDING
// ============================================================

let productionInviteState = null;
let editingProductionMemberId = null;

async function loadProductionInvite(token) {
  if (!token) throw new Error("This invitation link is missing its invitation token.");
  const { data, error } = await supabase.rpc("get_production_invite", {
    p_invite_token: token
  });
  if (error) throw error;
  if (!data?.email) throw new Error("This invitation is invalid, expired, or already used.");
  return data;
}

async function prepareMemberSignupScreen() {
  const form = $("memberSignupForm");
  const message = $("memberSignupMessage");
  if (!form) return;

  form.hidden = false;
  message.textContent = "";
  productionInviteState = null;

  try {
    const invite = await loadProductionInvite(getMemberInviteToken());
    productionInviteState = { ...invite, token: getMemberInviteToken() };

    $("memberSignupName").value = invite.name || "";
    $("memberSignupEmail").value = invite.email || "";
    $("memberSignupSection").textContent = invite.section_label || "Production team";
    $("memberSignupSubtitle").textContent =
      `This invitation is for ${invite.email}. Create a password for your production account.`;
  } catch (error) {
    form.hidden = true;
    $("memberSignupSubtitle").textContent = "This invitation cannot be used.";
    message.textContent = error?.message || "Unable to load this invitation.";
  }
}

$("memberSignupForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const message = $("memberSignupMessage");
  message.textContent = "";

  try {
    if (!productionInviteState?.email || !productionInviteState?.token) {
      throw new Error("This invitation is invalid. Open the invitation link again.");
    }

    const password = $("memberSignupPassword").value;
    const confirm = $("memberSignupConfirmPassword").value;

    if (password.length < 8) throw new Error("Password must be at least 8 characters.");
    if (password !== confirm) throw new Error("Passwords do not match.");

    setLoading($("memberSignupButton"), "Creating account...");

    const signup = await supabase.auth.signUp({
      email: productionInviteState.email,
      password
    });

    if (signup.error) throw signup.error;

    if (signup.data?.session) {
      const accepted = await supabase.rpc("accept_production_member_invite", {
        p_invite_token: productionInviteState.token
      });
      if (accepted.error) throw accepted.error;

      actorContextCache = {
        actor_type: "production_member",
        member_id: accepted.data?.member_id || accepted?.data?.member_id || null,
        seller_id: accepted.data?.seller_id || accepted?.data?.seller_id || null,
        name: accepted.data?.name || productionInviteState.name || "Production Member",
        email: accepted.data?.email || productionInviteState.email,
        section_label: productionInviteState.section_label || null,
        role: "production_member",
        can_view_production: true,
        can_scan_qr: true,
        can_finish_stage: true,
        can_upload_proof: true
      };
      try { localStorage.setItem("ordeli-actor-context", JSON.stringify(actorContextCache)); } catch (_) {}
      try { localStorage.removeItem("ordeli-member-login-email"); } catch (_) {}
      window.location.hash = "production";
      showToast("Production account created.", "success");
    } else {
      try { localStorage.setItem("ordeli-member-login-email", productionInviteState.email); } catch (_) {}
      message.textContent = "Account created. Confirm the email if required, then sign in using the same email and password.";
    }
  } catch (error) {
    console.error("Production member signup failed:", error);
    message.textContent = getAuthError(error);
  } finally {
    resetButton($("memberSignupButton"), "Create Production Account");
  }
});

$("memberSignupLoginLink")?.addEventListener("click", () => {
  const email = productionInviteState?.email || "";
  try { if (email) localStorage.setItem("ordeli-member-login-email", email); } catch (_) {}
  navigate("login");
});

// ============================================================
// AUTH FORMS
// ============================================================

try {
  const invitedEmail = localStorage.getItem("ordeli-member-login-email");
  if (invitedEmail && $("loginEmail") && !$("loginEmail").value) {
    $("loginEmail").value = invitedEmail;
  }
} catch (_) {}

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


        window.location.hash = "#home";
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


        // Keep the freshly saved seller profile in the local cache. The renderer
        // intentionally boots from cache first, so without this update it can
        // immediately read the pre-setup seller record and show Shop Setup again.
        await cacheNamed(`seller:${user.id}`, data);

        // Shop onboarding is complete. Move the hash away from the setup route
        // before rendering so the seller lands on the dashboard.
        if (getRoute() !== "home") navigate("home");
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
          "Save & Continue"
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

        $("shopLogoUploader")
          ?.classList
          .remove("has-preview");


        $("shopLogoPreview")
          .removeAttribute(
            "src"
          );

        $("shopLogoUploader")
          ?.classList
          .remove("has-preview");


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

        $("shopLogoUploader")
          ?.classList
          .add("has-preview");


      } catch (error) {

        $("shopLogo")
          .value =
            "";


        $("shopLogoPreviewContainer")
          .hidden =
            true;

        $("shopLogoUploader")
          ?.classList
          .remove("has-preview");


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


$("editShopButton")?.addEventListener(
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
// DASHBOARD / ORDERS / EVENTS / TEAM
// ============================================================

async function loadProductionWork() {
  const actor = await getActorContext(true);
  if (!actor || !isProductionMemberActor(actor)) {
    throw new Error("This account is not linked to an active production-team member.");
  }
  if (actor.can_view_production === false) {
    throw new Error("You do not have permission to view production work.");
  }
  const cacheKey = `production-work:${actor.member_id || actor.seller_id}`;
  if (navigator.onLine && !runtimeOffline) {
    try {
      const { data, error } = await supabase.rpc("get_production_work", { p_limit: 100 });
      if (error) throw error;
      const work = data || [];
      await cacheNamed(cacheKey, work);
      return work;
    } catch (error) {
      const cached = await getCachedSnapshot(cacheKey);
      if (cached != null) return cached;
      throw error;
    }
  }
  return (await getCachedSnapshot(cacheKey)) || [];
}

function productionTaskCard(task, actor) {
  const card = document.createElement("article");
  card.className = "production-work-card";
  card.dataset.productionTaskId = task.order_item_id;

  const title = document.createElement("div");
  title.className = "production-work-card-head";
  title.innerHTML = `<div><strong>${escapeHtml(task.product_name || "Product")}</strong><span>Order #${escapeHtml(String(task.order_number || ""))} · ${escapeHtml(task.customer_name || "Customer")}</span></div>`;

  const stage = document.createElement("div");
  stage.className = "production-work-stage";
  stage.innerHTML = `<span>Next stage</span><strong>${escapeHtml(task.stage_name || "—")}</strong><small>Quantity: ${escapeHtml(String(task.quantity || 0))}</small>`;

  const actions = document.createElement("div");
  actions.className = "production-work-actions";

  const photo = document.createElement("input");
  photo.type = "file";
  photo.accept = "image/jpeg,image/png,image/webp";
  photo.className = "production-proof-input";

  const proofLabel = document.createElement("label");
  proofLabel.className = "production-proof-label";
  proofLabel.textContent = "Optional proof photo";
  proofLabel.appendChild(photo);

  const finish = document.createElement("button");
  finish.type = "button";
  finish.textContent = "Finish Stage";
  finish.disabled = actor.can_finish_stage === false;
  finish.addEventListener("click", async () => {
    const note = window.prompt("Optional note for this stage:") || null;
    await completeMemberProductionTask(task, note, photo.files?.[0] || null, finish);
  });

  actions.append(proofLabel, finish);
  card.append(title, stage, actions);
  return card;
}

async function renderProductionWork(actor) {
  const list = $("productionWorkList");
  const empty = $("productionEmptyState");
  const count = $("productionWorkCount");
  const subtitle = $("productionMemberSubtitle");
  if (!list) return;
  subtitle.textContent = `${actor.name || "Team member"}${actor.section_label ? ` · ${actor.section_label}` : ""}`;
  list.replaceChildren();
  $("productionMessage").textContent = "";
  try {
    const work = await loadProductionWork();
    count.textContent = String(work.length);
    empty.hidden = work.length !== 0;
    work.forEach(task => list.appendChild(productionTaskCard(task, actor)));
  } catch (error) {
    empty.hidden = true;
    $("productionMessage").textContent = error?.message || "Unable to load production work.";
  }
}

async function resolveProductionQr(scannedText) {
  const token = extractQrToken(scannedText);
  if (!token) throw new Error("The scanned QR does not contain a valid Ordeli tracking token.");
  const { data, error } = await supabase.rpc("resolve_production_qr", { p_public_token: token });
  if (error) throw error;
  if (!data?.order_item_id) throw new Error("This QR is not assigned to an active production item.");
  return data;
}

async function showProductionScannedItem(item) {
  const box = $("productionScannedItem");
  if (!box) return;
  box.replaceChildren();
  box.hidden = false;

  const title = document.createElement("h3");
  title.textContent = `${item.product_name || "Product"} · Order #${item.order_number || ""}`;
  const meta = document.createElement("p");
  meta.textContent = `${item.customer_name || "Customer"} · Quantity ${item.quantity || 0}`;
  const stage = document.createElement("p");
  stage.innerHTML = `<strong>Next stage:</strong> ${escapeHtml(item.stage_name || "All stages finished")}`;

  const note = document.createElement("textarea");
  note.rows = 3;
  note.maxLength = 500;
  note.placeholder = "Optional note";

  const photo = document.createElement("input");
  photo.type = "file";
  photo.accept = "image/jpeg,image/png,image/webp";

  const finish = document.createElement("button");
  finish.type = "button";
  finish.textContent = "Finish Stage";
  const actor = await getActorContext(true);
  finish.disabled = actor?.can_finish_stage === false || !item.stage_name;
  finish.addEventListener("click", async () => {
    await completeMemberProductionTask(item, note.value.trim() || null, photo.files?.[0] || null, finish);
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary-button";
  cancel.textContent = "Close";
  cancel.addEventListener("click", () => { box.hidden = true; box.replaceChildren(); });

  box.append(title, meta, stage, document.createTextNode("Proof photo (optional)"), photo, note, finish, cancel);
}

async function completeMemberProductionTask(task, note, file, button) {
  if (productionBusyItemId) return;
  productionBusyItemId = task.order_item_id;
  setLoading(button, "Saving…");
  let uploadedPath = null;
  try {
    const actor = await getActorContext(true);
    if (!actor?.can_finish_stage) throw new Error("You do not have permission to finish production stages.");

    if (file) {
      const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
      uploadedPath = `${actor.seller_id}/${task.order_item_id}/${task.stage_order || "current"}-${crypto.randomUUID()}.${extension}`;
    }

    if (!navigator.onLine || runtimeOffline) {
      await enqueueOfflineProductionStage({
        actorType: "production_member",
        orderItemId: task.order_item_id,
        stageOrder: task.stage_order || null,
        note: note || null,
        proofPath: uploadedPath,
        file: file || null
      });
      const scannedBox = $("productionScannedItem");
      if (scannedBox) {
        scannedBox.replaceChildren();
        scannedBox.hidden = false;
        const successTitle = document.createElement("h3");
        successTitle.textContent = "Saved offline";
        const successText = document.createElement("p");
        successText.textContent = "This production update is saved on this device and will synchronize automatically when you reconnect.";
        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "secondary-button";
        closeButton.textContent = "Back to Production Work";
        closeButton.addEventListener("click", async () => { scannedBox.hidden = true; scannedBox.replaceChildren(); try { await renderProductionWork(actor); } catch (_) {} });
        scannedBox.append(successTitle, successText, closeButton);
      }
      document.querySelectorAll("[data-production-task-id]").forEach(node => { if (node.dataset.productionTaskId === String(task.order_item_id)) node.remove(); });
      const cachedWork = await getCachedSnapshot(`production-work:${actor.member_id || actor.seller_id}`) || [];
      await cacheNamed(`production-work:${actor.member_id || actor.seller_id}`, cachedWork.filter(row => String(row.order_item_id) !== String(task.order_item_id)));
      await updateConnectivityIndicator();
      showToast("Stage saved offline — waiting to sync.", "success");
      return;
    }

    if (file) {
      const { error: uploadError } = await supabase.storage.from("production-proofs").upload(uploadedPath, file, {
        cacheControl: "3600", upsert: false, contentType: file.type
      });
      if (uploadError) throw uploadError;
    }

    const { data, error } = await supabase.rpc("finish_production_stage_member_v2", {
      p_order_item_id: task.order_item_id,
      p_note: note || null,
      p_proof_photo_path: uploadedPath
    });
    if (error) throw error;

    // The server has already confirmed the save. Update the UI immediately
    // instead of waiting for another role/session lookup to finish.
    const scannedBox = $("productionScannedItem");
    if (scannedBox) {
      scannedBox.replaceChildren();
      scannedBox.hidden = false;

      const successTitle = document.createElement("h3");
      successTitle.textContent = data?.completed
        ? "Production item completed"
        : `${data?.stage_name || "Stage"} finished`;

      const successText = document.createElement("p");
      successText.textContent = data?.completed
        ? "All production stages for this item are finished."
        : data?.next_stage_order != null
          ? "Saved successfully. The next production stage is now available."
          : "Saved successfully.";

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "secondary-button";
      closeButton.textContent = "Back to Production Work";
      closeButton.addEventListener("click", async () => {
        scannedBox.hidden = true;
        scannedBox.replaceChildren();
        try {
          const refreshedActor = actorContextCache || await getActorContext(false);
          await renderProductionWork(refreshedActor);
        } catch (refreshError) {
          $("productionMessage").textContent =
            refreshError?.message || "Saved, but the task list could not be refreshed.";
        }
      });

      scannedBox.append(successTitle, successText, closeButton);
    }

    // Remove the just-finished task from the visible task list immediately.
    document
      .querySelectorAll("[data-production-task-id]")
      .forEach((node) => {
        if (node.dataset.productionTaskId === String(task.order_item_id)) node.remove();
      });

    const remaining = document.querySelectorAll("[data-production-task-id]").length;
    if ($("productionWorkCount")) $("productionWorkCount").textContent = String(remaining);
    if ($("productionEmptyState")) $("productionEmptyState").hidden = remaining !== 0;

    showToast(data?.completed ? "Final stage finished — product completed." : "Stage finished.", "success");
  } catch (error) {
    if (uploadedPath) {
      try { await supabase.storage.from("production-proofs").remove([uploadedPath]); } catch (_) {}
    }
    showToast(error?.message || "Unable to finish stage.", "error");
  } finally {
    productionBusyItemId = null;
    resetButton(button, "Finish Stage");
  }
}

async function startProductionQrScanner() {
  if (productionScannerInstance) return;
  const panel = $("productionScannerPanel");
  const reader = $("productionQrReader");
  if (!panel || !reader) return;
  panel.hidden = false;
  $("productionScannerMessage").textContent = "";
  try {
    await ensureExternalScript("scanner");
    productionScannerInstance = new Html5Qrcode("productionQrReader");
    await productionScannerInstance.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, async decodedText => {
      if (productionScanBusy) return;
      productionScanBusy = true;
      try {
        const item = await resolveProductionQr(decodedText);
        await stopProductionQrScanner();
        await showProductionScannedItem(item);
      } catch (error) {
        $("productionScannerMessage").textContent = error?.message || "Unable to read this production QR.";
      } finally {
        productionScanBusy = false;
      }
    }, () => {});
  } catch (error) {
    $("productionScannerMessage").textContent = error?.message || "Unable to start the QR scanner. Use manual entry instead.";
  }
}

async function stopProductionQrScanner() {
  if (!productionScannerInstance) {
    if ($("productionScannerPanel")) $("productionScannerPanel").hidden = true;
    return;
  }
  try {
    if (productionScannerInstance.isScanning) await productionScannerInstance.stop();
    await productionScannerInstance.clear();
  } catch (_) {} finally {
    productionScannerInstance = null;
    if ($("productionScannerPanel")) $("productionScannerPanel").hidden = true;
  }
}

$("teamButton")?.addEventListener("click", () => { navigate("team"); renderTeam(); });
$("teamBackButton")?.addEventListener("click", () => navigate("home"));
$("productionRefreshButton")?.addEventListener("click", async () => { try { await renderProductionWork(await getActorContext(true)); } catch (error) { $("productionMessage").textContent = error?.message || "Unable to refresh."; } });
$("productionScanButton")?.addEventListener("click", () => startProductionQrScanner());
$("productionScannerCloseButton")?.addEventListener("click", () => stopProductionQrScanner());
$("productionManualQrButton")?.addEventListener("click", async () => {
  const value = window.prompt("Enter the QR tracking URL or token:");
  if (!value) return;
  try { await showProductionScannedItem(await resolveProductionQr(value)); }
  catch (error) { $("productionScannerMessage").textContent = error?.message || "Unable to resolve that QR."; }
});
$("productionLogoutButton")?.addEventListener("click", async () => { await supabase.auth.signOut(); location.hash = "login"; location.reload(); });

async function loadTeamMembers() {
  const user = await getCurrentUser();
  const { data, error } = await supabase.from("production_members").select("id,name,email,section_label,role,can_view_production,can_scan_qr,can_finish_stage,can_upload_proof,is_active,invite_status,created_at").eq("seller_id", user.id).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function renderTeam() {
  const list = $("teamList"); if (!list) return;
  list.replaceChildren();
  const empty = $("teamEmptyState");
  try {
    const members = await loadTeamMembers();
    empty.hidden = members.length !== 0;
    members.forEach(member => {
      const card = document.createElement("article");
      card.className = "team-member-card";

      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = member.name || "Unnamed member";
      const email = document.createElement("span");
      email.textContent = member.email || "";
      const status = member.invite_status === "accepted" ? (member.is_active ? "Active" : "Disabled") : (member.is_active ? "Invited" : "Disabled");
      const meta = document.createElement("small");
      meta.textContent = `${member.section_label || "No section"} · ${status}`;
      info.append(name, email, meta);

      const right = document.createElement("div");
      right.className = "team-member-card-actions";

      const permissions = document.createElement("div");
      permissions.className = "team-permission-summary";
      [
        ["View", member.can_view_production],
        ["Finish", member.can_finish_stage],
        ["Proof", member.can_upload_proof],
        ["Scan", member.can_scan_qr]
      ].forEach(([label, enabled]) => {
        const pill = document.createElement("span");
        pill.textContent = enabled ? label : `— ${label}`;
        if (!enabled) pill.classList.add("team-permission-disabled");
        permissions.appendChild(pill);
      });

      const actions = document.createElement("div");
      actions.className = "team-member-actions";

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "secondary-button";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => startEditProductionMember(member));

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = member.is_active ? "secondary-button" : "secondary-button";
      toggle.textContent = member.is_active ? "Disable" : "Enable";
      toggle.addEventListener("click", async () => {
        const action = member.is_active ? "disable" : "enable";
        if (!window.confirm(`${action === "disable" ? "Disable" : "Enable"} ${member.name || "this team member"}?`)) return;
        try {
          toggle.disabled = true;
          const { error } = await supabase.rpc("set_production_member_active", { p_member_id: member.id, p_active: !member.is_active });
          if (error) throw error;
          if (editingProductionMemberId === member.id) cancelEditProductionMember();
          await renderTeam();
        } catch (error) {
          $("teamMemberMessage").textContent = error?.message || `Unable to ${action} team member.`;
          toggle.disabled = false;
        }
      });

      actions.append(edit, toggle);
      right.append(permissions, actions);
      card.append(info, right);
      list.append(card);
    });
  } catch (error) {
    empty.hidden = false;
    $("teamMemberMessage").textContent = error?.message || "Unable to load team.";
  }
}

function startEditProductionMember(member) {
  editingProductionMemberId = member.id;
  $("teamMemberName").value = member.name || "";
  $("teamMemberEmail").value = member.email || "";
  $("teamMemberEmail").disabled = true;
  $("teamMemberSection").value = member.section_label || "";
  $("teamCanView").checked = member.can_view_production !== false;
  $("teamCanScan").checked = member.can_scan_qr !== false;
  $("teamCanFinish").checked = member.can_finish_stage !== false;
  $("teamCanProof").checked = member.can_upload_proof !== false;
  const heading = document.querySelector("#teamMemberForm")?.closest(".team-create-card")?.querySelector("h2");
  if (heading) heading.textContent = "Edit Team Member";
  $("inviteTeamMemberButton").textContent = "Save Changes";
  let cancel = $("cancelTeamMemberEditButton");
  if (!cancel) {
    cancel = document.createElement("button");
    cancel.id = "cancelTeamMemberEditButton";
    cancel.type = "button";
    cancel.className = "secondary-button";
    cancel.textContent = "Cancel Edit";
    $("inviteTeamMemberButton").insertAdjacentElement("afterend", cancel);
    cancel.addEventListener("click", cancelEditProductionMember);
  }
  cancel.hidden = false;
  $("teamMemberName").focus();
}

function cancelEditProductionMember() {
  editingProductionMemberId = null;
  $("teamMemberForm")?.reset();
  $("teamMemberEmail").disabled = false;
  $("teamCanView").checked = $("teamCanScan").checked = $("teamCanFinish").checked = $("teamCanProof").checked = true;
  const heading = document.querySelector("#teamMemberForm")?.closest(".team-create-card")?.querySelector("h2");
  if (heading) heading.textContent = "Invite Team Member";
  $("inviteTeamMemberButton").textContent = "Create Invitation";
  const cancel = $("cancelTeamMemberEditButton");
  if (cancel) cancel.hidden = true;
  $("teamMemberMessage").textContent = "";
}


$("teamMemberForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const message = $("teamMemberMessage");
  message.textContent = "";
  message.className = "form-message";
  try {
    if (editingProductionMemberId) {
      const payload = {
        p_member_id: editingProductionMemberId,
        p_name: $("teamMemberName").value.trim(),
        p_section_label: $("teamMemberSection").value.trim() || null,
        p_can_view_production: $("teamCanView").checked,
        p_can_scan_qr: $("teamCanScan").checked,
        p_can_finish_stage: $("teamCanFinish").checked,
        p_can_upload_proof: $("teamCanProof").checked
      };
      const { error } = await supabase.rpc("update_production_member", payload);
      if (error) throw error;
      message.textContent = "Team member updated.";
      cancelEditProductionMember();
      await renderTeam();
      return;
    }

    const payload = {
      p_name: $("teamMemberName").value.trim(),
      p_email: $("teamMemberEmail").value.trim().toLowerCase(),
      p_section_label: $("teamMemberSection").value.trim() || null,
      p_can_view_production: $("teamCanView").checked,
      p_can_scan_qr: $("teamCanScan").checked,
      p_can_finish_stage: $("teamCanFinish").checked,
      p_can_upload_proof: $("teamCanProof").checked
    };
    const { data, error } = await supabase.rpc("create_production_member_invite", payload);
    if (error) throw error;
    const invite = data || {};
    message.replaceChildren();
    message.className = "form-message success-message";

    if (invite.invite_token) {
      const inviteUrl = `${window.location.origin}${window.location.pathname}#member-signup/${encodeURIComponent(invite.invite_token)}`;
      const result = document.createElement("div");
      result.className = "team-invite-result";

      const title = document.createElement("strong");
      title.textContent = "Invitation ready";
      const text = document.createElement("span");
      text.textContent = `Send this link to ${payload.p_email}. They will create their own password.`;
      const link = document.createElement("code");
      link.textContent = inviteUrl;

      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "secondary-button";
      copy.textContent = "Copy Invite Link";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(inviteUrl);
          copy.textContent = "Copied";
          setTimeout(() => { copy.textContent = "Copy Invite Link"; }, 1500);
        } catch (_) {
          result.appendChild(document.createTextNode(" Copy manually."));
        }
      });

      result.append(title, text, link, copy);
      message.appendChild(result);
    } else {
      message.textContent = `Invitation created for ${payload.p_email}.`;
    }

    event.target.reset();
    $("teamCanView").checked = $("teamCanScan").checked = $("teamCanFinish").checked = $("teamCanProof").checked = true;
    await renderTeam();
  } catch (error) {
    message.className = "form-message";
    message.textContent = error?.message || "Unable to save team member.";
  }
});


$("homeOrdersButton")?.addEventListener("click", () => navigate("orders"));
$("homeViewOrdersButton")?.addEventListener("click", () => navigate("orders"));
$("homeEventsButton")?.addEventListener("click", () => navigate("events"));
$("updatesBackButton")?.addEventListener("click", () => navigate("home"));
$("updatesRefreshButton")?.addEventListener("click", () => loadSmsUpdates());
$("ordersBackButton")?.addEventListener("click", () => navigate("home"));
$("ordersScanButton")?.addEventListener("click", () => navigate("scanner"));
$("eventsBackButton")?.addEventListener("click", () => navigate("home"));
$("reviewsBackButton")?.addEventListener("click", () => navigate("home"));

function closeHomeMenu() {
  const menu = $("homeMenu");
  const backdrop = $("homeMenuBackdrop");
  const button = $("homeMenuButton");
  if (!menu) return;
  menu.hidden = true;
  if (backdrop) backdrop.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
  document.body.classList.remove("home-menu-open");
}

function openHomeMenu() {
  const menu = $("homeMenu");
  const backdrop = $("homeMenuBackdrop");
  const button = $("homeMenuButton");
  if (!menu) return;
  menu.hidden = false;
  if (backdrop) backdrop.hidden = false;
  if (button) button.setAttribute("aria-expanded", "true");
  document.body.classList.add("home-menu-open");
}

$("homeMenuButton")?.addEventListener("click", openHomeMenu);
$("homeMenuCloseButton")?.addEventListener("click", closeHomeMenu);
$("homeMenuBackdrop")?.addEventListener("click", closeHomeMenu);
$("homeMenuLogoutButton")?.addEventListener("click", async () => { closeHomeMenu(); await logout(); });
$("homeMenuShopProfileButton")?.addEventListener("click", () => { closeHomeMenu(); navigate("shop-setup"); });
document.querySelectorAll("[data-home-menu-route]").forEach(button => {
  button.addEventListener("click", () => {
    const route = button.dataset.homeMenuRoute;
    closeHomeMenu();
    navigate(route);
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("homeMenu") && !$("homeMenu").hidden) closeHomeMenu();
});

$("newEventButton")?.addEventListener("click", () => { if ($("eventForm").hidden) openEventEditor(); else closeEventEditor(); });

["eventDate", "eventStartTime", "eventEndTime"].forEach((id) => {
  ["input", "change"].forEach((eventName) => {
    $(id)?.addEventListener(eventName, updateEventChangeReasonVisibility);
  });
});
$("cancelEventButton")?.addEventListener("click", closeEventEditor);
$("eventForm")?.addEventListener("submit", saveEventForm);
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


async function openProductEditor(
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



  await populateProductCancellationOptions(
    product?.id || null,
    product?.customer_cancellable_until_stage ?? ""
  );
  setProductCancellationUi(Boolean(product?.customer_cancellable_until_stage));

  $("productEditor")
    .hidden =
      false;


  $("productName")
    .focus();

}


function setProductCancellationUi(enabled) {
  const checkbox = $("productCancellationEnabled");
  const group = $("productCancellationStageGroup");
  const select = $("productCancellationCutoff");
  if (checkbox) checkbox.checked = Boolean(enabled);
  if (group) group.hidden = !enabled;
  if (select) select.disabled = !enabled;
}

$("productCancellationEnabled")?.addEventListener("change", event => {
  const enabled = Boolean(event.target.checked);
  setProductCancellationUi(enabled);
  if (!enabled && $("productCancellationCutoff")) $("productCancellationCutoff").value = "";
});

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



async function populateProductCancellationOptions(productId, selectedValue = "") {
  const select = $("productCancellationCutoff");
  const checkbox = $("productCancellationEnabled");
  if (!select) return;
  select.replaceChildren();
  if (!productId) {
    select.appendChild(new Option("Add production stages first", ""));
    select.disabled = true;
    if (checkbox) checkbox.disabled = true;
    return;
  }
  if (checkbox) checkbox.disabled = false;
  try {
    const user = await getCurrentUser();
    const result = await supabase
      .from("production_stages")
      .select("stage_order,name")
      .eq("product_id", productId)
      .order("stage_order", { ascending: true });
    if (result.error) throw result.error;
    const stages = result.data || [];
    if (!stages.length) {
      select.appendChild(new Option("Add production stages first", ""));
      select.disabled = true;
      if (checkbox) checkbox.checked = false;
      return;
    }
    stages.forEach(stage => {
      select.appendChild(new Option(`${stage.stage_order}. ${stage.name}`, String(stage.stage_order)));
    });
    select.value = selectedValue === null || selectedValue === undefined ? "" : String(selectedValue);
    select.disabled = false;
  } catch (error) {
    console.warn("Unable to load cancellation stages:", error);
  }
}

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

          customer_cancellable_until_stage:
            $("productCancellationEnabled")?.checked && $("productCancellationCutoff")?.value
              ? Number($("productCancellationCutoff").value)
              : null,

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
            price,

          customer_cancellable_until_stage:
            $("productCancellationEnabled")?.checked && $("productCancellationCutoff")?.value
              ? Number($("productCancellationCutoff").value)
              : null

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


$("productsButton")?
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

  const revoke = document.createElement("button");
  revoke.type = "button";
  revoke.className = "secondary-button";
  revoke.textContent = "Revoke QR";
  revoke.disabled = group.available < 1;
  revoke.addEventListener("click", async () => {
    if (group.available < 1) return;
    const code = window.prompt(`Enter the seller code printed on the QR card to revoke it.\n\nSeries: ${group.seriesName}`);
    if (code === null) return;
    const normalized = code.trim();
    if (!normalized) return;
    if (!window.confirm(`Revoke QR code ${normalized}?\n\nA revoked QR cannot be assigned to a new order.`)) return;
    try {
      const { data, error } = await supabase.rpc("revoke_qr_code", { p_code: normalized });
      if (error) throw error;
      if (!data?.revoked) throw new Error(data?.message || "QR code was not revoked.");
      await refreshOfflineQrCache();
      await loadQrSeries();
      alert(`QR code ${normalized} was revoked.`);
    } catch (error) {
      console.error("QR revoke failed:", error);
      alert(error?.message || "Unable to revoke that QR code.");
    }
  });
  actions.appendChild(revoke);


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

$("qrButton")?.addEventListener("click",()=>navigate("qr"));
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
    await ensureExternalScript("qrcode");

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

  if (scannerInstance) return;

  try {
    await ensureExternalScript("scanner");
  } catch (error) {
    $("scannerMessage").textContent = error?.message || "QR scanner library could not be loaded.";
    return;
  }

  if (typeof Html5Qrcode === "undefined") {
    $("scannerMessage").textContent = "QR scanner library could not be loaded.";
    return;
  }

  scannerInstance = new Html5Qrcode("qrReader");

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

function getOrderItemProductionComplete(item) {
  if (item?.cancelled_at) return true;
  const workflow = normaliseWorkflowSnapshot(item?.workflow_snapshot);
  if (!workflow.length) return true;
  const logs = Array.isArray(item?.stage_logs) ? [...item.stage_logs].sort((a,b) => new Date(a.occurred_at || 0) - new Date(b.occurred_at || 0)) : [];
  return workflow.every(stage => {
    const matches = logs.filter(log => Number(log.stage_order) === Number(stage.stage_order));
    const latest = matches.length ? matches[matches.length - 1] : null;
    return latest?.action === 'finished';
  });
}

function getOrderProductionComplete(items) {
  const active = (items || []).filter(item => !item.cancelled_at);
  return active.length > 0 && active.every(getOrderItemProductionComplete);
}

function fulfillmentSellerLabel(value) {
  return value === 'shop' ? 'Pickup at Shop' : value === 'location' ? 'Pickup at Location' : value === 'courier' ? 'Courier Delivery' : 'Not selected';
}

function pickupStatusLabel(value) {
  const labels = { not_scheduled: 'Not scheduled', scheduled: 'Scheduled', bring_to_event: 'Bring to Event', unclaimed: 'Unclaimed', handed_over: 'Handed Over' };
  return labels[value] || (value ? String(value).replaceAll('_',' ') : 'Not scheduled');
}

function renderOrderFulfillmentSummary(order, items, total, paid) {
  const box = $('orderDetailFulfillmentSummary');
  if (!box) return;
  box.hidden = false;
  const complete = getOrderProductionComplete(items);
  const fullyPaid = paid >= total && total >= 0;
  $('orderDetailFulfillmentText').textContent = `${fulfillmentSellerLabel(order?.fulfillment_type)} · ${complete ? 'Production complete' : 'Production in progress'} · ${fullyPaid ? 'Fully paid' : 'Balance remaining'}`;
  $('orderDetailPickupStatus').textContent = pickupStatusLabel(order?.pickup_status);

  const eventInfo = $('orderDetailEventInfo');
  const event = order?.events;
  if (event) {
    eventInfo.hidden = false;
    const dateText = event.event_date ? new Intl.DateTimeFormat('en-PH', {weekday:'short', month:'short', day:'numeric', year:'numeric'}).format(new Date(`${event.event_date}T00:00:00`)) : '';
    const timeText = event.start_time ? ` · ${event.start_time.slice(0,5)}${event.end_time ? `–${event.end_time.slice(0,5)}` : ''}` : '';
    eventInfo.textContent = `${event.name} · ${event.location}${dateText ? ` · ${dateText}` : ''}${timeText}`;
  } else {
    eventInfo.hidden = true; eventInfo.textContent = '';
  }

  const handover = $('orderDetailHandoverButton');
  const unclaimed = $('orderDetailUnclaimedButton');
  const already = Boolean(order?.handed_over_at);
  const canHandover = !already && (order?.fulfillment_type === 'shop' || order?.fulfillment_type === 'location') && complete && fullyPaid;
  if (handover) { handover.hidden = !canHandover; handover.disabled = false; }
  if (unclaimed) {
    const canUnclaim = !already && order?.fulfillment_type === 'location' && order?.event_id && order?.pickup_status !== 'unclaimed';
    unclaimed.hidden = !canUnclaim;
    unclaimed.disabled = false;
  }
}

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
      const orderResult = await supabase.from("orders").select(`id,order_number,customer_id,created_at,fulfillment_type,event_id,pickup_status,handed_over_at,cancelled_at,customers(id,name,phone),events(id,name,location,event_date,start_time,end_time,status)`).eq("id", orderId).eq("seller_id", user.id).single();
      if (orderResult.error) throw orderResult.error;
      order = orderResult.data;
      const itemsResult = await supabase.from("order_items").select(`id,product_name,quantity,unit_price,total_price,workflow_snapshot,cancelled_at,stage_logs(id,stage_order,action,occurred_at)`).eq("order_id", orderId).eq("seller_id", user.id).order("created_at", {ascending:true});
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
    if (!item.cancelled_at) total += Number(item.total_price) || 0;
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
  renderOrderFulfillmentSummary(order, items, total, paid);
  renderSellerCancellationActions(order, items);
  await loadPayments(orderId);
}



function renderSellerCancellationActions(order, items) {
  const container = $('orderDetailCancellationActions');
  if (container) container.remove();
  if (!order || order.cancelled_at) return;
  if (order.handed_over_at) return;
  const activeItems = (items || []).filter(item => !item.cancelled_at);
  if (!activeItems.length) return;

  const box = document.createElement('section');
  box.id = 'orderDetailCancellationActions';
  box.className = 'order-detail-cancellation-actions';

  const title = document.createElement('strong');
  title.textContent = 'Cancellation';
  box.appendChild(title);

  const help = document.createElement('p');
  help.textContent = 'Cancel the whole order or an individual item. The historical record is kept.';
  box.appendChild(help);

  const itemList = document.createElement('div');
  itemList.className = 'order-cancel-item-list';
  activeItems.forEach(item => {
    const row = document.createElement('div');
    row.className = 'order-cancel-item-row';
    const label = document.createElement('span');
    label.textContent = `${item.product_name} × ${item.quantity}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.textContent = 'Cancel Item';
    button.addEventListener('click', async () => {
      const reason = window.prompt(`Cancel ${item.product_name} × ${item.quantity}?\n\nOptional reason:`, 'Seller unable to fulfill');
      if (reason === null) return;
      button.disabled = true;
      try {
        const { error } = await supabase.rpc('seller_cancel_order_item', {
          p_order_item_id: item.id,
          p_reason: reason.trim() || null
        });
        if (error) throw error;
        await loadOrderDetail(order.id);
      } catch (error) {
        console.error('Seller item cancellation failed:', error);
        $('orderDetailMessage').textContent = error?.message || 'Unable to cancel this item.';
        button.disabled = false;
      }
    });
    row.append(label, button);
    itemList.appendChild(row);
  });
  box.appendChild(itemList);

  const cancelOrder = document.createElement('button');
  cancelOrder.type = 'button';
  cancelOrder.className = 'danger-button';
  cancelOrder.textContent = 'Cancel Entire Order';
  cancelOrder.addEventListener('click', async () => {
    const reason = window.prompt(`Cancel Order #${order.order_number}?\n\nOptional reason:`, 'Seller unable to fulfill');
    if (reason === null) return;
    if (!window.confirm(`Cancel Order #${order.order_number}? This will cancel every active item in the order.`)) return;
    cancelOrder.disabled = true;
    try {
      const { error } = await supabase.rpc('seller_cancel_order', {
        p_order_id: order.id,
        p_reason: reason.trim() || null
      });
      if (error) throw error;
      await loadOrderDetail(order.id);
    } catch (error) {
      console.error('Seller order cancellation failed:', error);
      $('orderDetailMessage').textContent = error?.message || 'Unable to cancel the order.';
      cancelOrder.disabled = false;
    }
  });
  box.appendChild(cancelOrder);

  const itemsHost = $('orderDetailItems');
  if (itemsHost?.parentElement) itemsHost.parentElement.appendChild(box);
}

function clearOrderDetailScreen() {
  currentOrderTotal = 0;
  currentOrderPaid = 0;
  ["orderDetailTitle","orderDetailNumber","orderDetailCustomerName","orderDetailCustomer","orderDetailTotal","orderDetailPaid","orderDetailBalance"].forEach(id => { if ($(id)) $(id).textContent = ""; });
  if ($("orderDetailItems")) $("orderDetailItems").replaceChildren();
  $("orderDetailCancellationActions")?.remove();
  if ($("orderDetailMessage")) $("orderDetailMessage").textContent = "";
  if ($("orderDetailFulfillmentSummary")) $("orderDetailFulfillmentSummary").hidden = true;
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


async function updateOrderPickupAction(action) {
  if (!currentOrderId) return;
  const button = action === 'handed_over' ? $('orderDetailHandoverButton') : $('orderDetailUnclaimedButton');
  const original = button?.textContent || '';
  if (button) { button.disabled = true; button.textContent = action === 'handed_over' ? 'Handing Over…' : 'Saving…'; }
  try {
    const { data, error } = await supabase.rpc('update_order_pickup_status', { p_order_id: currentOrderId, p_action: action });
    if (error) throw error;
    if (!data) throw new Error('The pickup update was not saved.');
    await loadOrderDetail(currentOrderId);
  } catch (error) {
    $('orderDetailMessage').textContent = error?.message || 'Unable to update pickup status.';
  } finally {
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

$('orderDetailHandoverButton')?.addEventListener('click', () => updateOrderPickupAction('handed_over'));
$('orderDetailUnclaimedButton')?.addEventListener('click', () => updateOrderPickupAction('unclaimed'));

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
    if (file) {
      const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
      proofPath = `${user.id}/${item.id}/${stage.stage_order}-${crypto.randomUUID()}.${extension}`;
    }

    if (!navigator.onLine || runtimeOffline) {
      await enqueueOfflineProductionStage({
        actorType: "seller",
        orderId: currentOrderId,
        orderItemId: item.id,
        stageOrder: stage.stage_order,
        stageName: stage.name,
        note: note || null,
        proofPath,
        file: file || null
      });

      const cachedItems = await getCachedSnapshot(`order-items:${currentOrderId}`) || [];
      const nextItems = cachedItems.map(cachedItem => {
        if (cachedItem.id !== item.id) return cachedItem;
        const logs = Array.isArray(cachedItem.stage_logs) ? [...cachedItem.stage_logs] : [];
        logs.push({ id: `offline-stage:${Date.now()}`, stage_order: stage.stage_order, action: "finished", note: note || null, proof_photo_path: proofPath, occurred_at: new Date().toISOString(), offline_pending: true });
        return { ...cachedItem, stage_logs: logs };
      });
      await cacheNamed(`order-items:${currentOrderId}`, nextItems);
      await loadOrderDetail(currentOrderId);
      showToast("Stage saved offline — waiting to sync.", "success");
      return;
    }

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
      const result = await supabase.from("payments").select(`id,amount,payment_type,proof_status,proof_path,rejection_reason,created_at`).eq("order_id", orderId).eq("seller_id", user.id).order("created_at", {ascending:true});
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
    right.appendChild(amount);
    if (payment.proof_status === "pending_verification") {
      const proofButton = document.createElement("button");
      proofButton.type = "button"; proofButton.className = "secondary-button payment-proof-button"; proofButton.textContent = "View Proof";
      proofButton.addEventListener("click", () => viewCustomerPaymentProof(payment));
      const confirmButton = document.createElement("button");
      confirmButton.type = "button"; confirmButton.className = "payment-confirm-button"; confirmButton.textContent = "Confirm";
      confirmButton.addEventListener("click", () => reviewCustomerPayment(payment, "confirmed"));
      const rejectButton = document.createElement("button");
      rejectButton.type = "button"; rejectButton.className = "secondary-button payment-reject-button"; rejectButton.textContent = "Reject";
      rejectButton.addEventListener("click", () => reviewCustomerPayment(payment, "rejected"));
      const actions = document.createElement("div"); actions.className = "payment-proof-actions"; actions.append(proofButton, confirmButton, rejectButton);
      right.appendChild(actions);
    }
    row.append(left, right);
    fragment.appendChild(row);
  });
  list.appendChild(fragment);
}


function openPaymentEditor() {
  const editor = $("paymentEditor");
  if (!editor) return;
  const remaining = Math.max(0, Number(currentOrderTotal || 0) - Number(currentOrderPaid || 0));
  if (remaining <= 0) {
    $("paymentMessage").textContent = "This order is already fully paid.";
    editor.hidden = false;
    $("paymentAmount").value = "";
    return;
  }
  $("paymentAmount").value = remaining.toFixed(2);
  $("paymentType").value = remaining > 0 ? "final" : "additional";
  $("paymentMessage").textContent = `Remaining balance: ${formatPrice(remaining)}`;
  editor.hidden = false;
  $("paymentAmount").focus();
}

function closePaymentEditor() {
  const editor = $("paymentEditor");
  if (!editor) return;
  editor.hidden = true;
  $("paymentAmount").value = "";
  $("paymentType").value = "additional";
  $("paymentMessage").textContent = "";
}

async function recordSellerPayment() {
  const amount = Number($("paymentAmount")?.value || 0);
  const paymentType = $("paymentType")?.value || "additional";
  const remaining = Math.max(0, Number(currentOrderTotal || 0) - Number(currentOrderPaid || 0));

  if (!currentOrderId) throw new Error("No order selected.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a payment amount greater than ₱0.00.");
  if (remaining <= 0) throw new Error("This order is already fully paid.");
  if (amount > remaining + 0.005) throw new Error(`Payment cannot exceed the remaining balance of ${formatPrice(remaining)}.`);
  if (!["additional", "final", "cash", "other"].includes(paymentType)) throw new Error("Choose a valid payment type.");

  const saveButton = $("savePaymentButton");
  setLoading(saveButton, true, "Recording…");
  $("paymentMessage").textContent = "";

  try {
    const { data, error } = await supabase.rpc("seller_record_payment", {
      p_order_id: currentOrderId,
      p_amount: Number(amount.toFixed(2)),
      p_payment_type: paymentType
    });
    if (error) throw error;
    if (!data?.payment_id) throw new Error("The payment was not recorded.");

    closePaymentEditor();
    await loadOrderDetail(currentOrderId);
    await loadPayments(currentOrderId);
    if (typeof loadDashboard === "function") loadDashboard(true).catch(() => {});
  } catch (error) {
    console.error("Seller payment recording failed:", error);
    $("paymentMessage").textContent = error?.message || "Unable to record payment.";
  } finally {
    resetButton(saveButton, "Record Payment");
  }
}

$("addPaymentButton")?.addEventListener("click", openPaymentEditor);
$("cancelPaymentButton")?.addEventListener("click", closePaymentEditor);
$("savePaymentButton")?.addEventListener("click", recordSellerPayment);

async function viewCustomerPaymentProof(payment) {
  if (!payment?.proof_path) { alert("This payment has no proof image."); return; }
  try {
    const { data, error } = await supabase.storage.from("payment-proofs").createSignedUrl(payment.proof_path, 300);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("Payment proof could not be opened.");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  } catch (error) {
    console.error("Payment proof open failed:", error);
    alert(error?.message || "Unable to open payment proof.");
  }
}

async function reviewCustomerPayment(payment, decision) {
  const message = decision === "rejected" ? prompt("Reason for rejecting this payment proof (optional):", "") : null;
  if (decision === "rejected" && message === null) return;
  try {
    const session = await getSession();
    const user = session?.user;
    if (!user) throw new Error("Please sign in again.");
    const { error } = await supabase.rpc("review_customer_payment", {
      p_payment_id: payment.id,
      p_decision: decision,
      p_rejection_reason: message || null
    });
    if (error) throw error;
    const cacheKey = `order-payments-full:${currentOrderId}`;
    const cached = await getCachedSnapshot(cacheKey);
    if (Array.isArray(cached)) {
      const updated = cached.map(row => row.id === payment.id ? { ...row, proof_status: decision, rejection_reason: message || null } : row);
      await cacheNamed(cacheKey, updated);
    }
    await loadOrderDetail(currentOrderId);
    await loadPayments(currentOrderId);
    if (typeof loadDashboard === "function") loadDashboard(true).catch(() => {});
  } catch (error) {
    console.error("Payment review failed:", error);
    alert(error?.message || "Unable to update payment proof.");
  }
}


async function loadSmsUpdates() {
  const user = await getCurrentUser();
  const list = $("updatesList");
  if (!list) return;
  list.replaceChildren();
  $("updatesMessage").textContent = "";
  $("updatesEmptyState").hidden = true;

  try {
    const result = await supabase
      .from("sms_update_drafts")
      .select("id,order_id,triggered_by_user_id,message_text,status,created_at,sent_marked_at,orders(order_number,customers(name,phone))")
      .eq("seller_id", user.id)
      .is("sent_marked_at", null)
      .order("created_at", { ascending: false })
      .limit(100);

    if (result.error) throw result.error;
    const drafts = result.data || [];
    $("updatesCount").textContent = `${drafts.length} update${drafts.length === 1 ? "" : "s"}`;

    if (!drafts.length) {
      $("updatesEmptyState").hidden = false;
      return;
    }

    drafts.forEach(draft => list.appendChild(createSmsDraftCard(draft)));
  } catch (error) {
    $("updatesMessage").textContent = error?.message || "Unable to load seller updates.";
  }
}

function createSmsDraftCard(draft) {
  const card = document.createElement("article");
  card.className = "sms-draft-card";

  const head = document.createElement("div");
  head.className = "sms-draft-head";
  const info = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = draft.orders?.customers?.name || "Customer";
  const meta = document.createElement("span");
  meta.textContent = `Order #${draft.orders?.order_number ?? "—"} · ${formatDate(draft.created_at)}`;
  info.append(title, meta);
  const badge = document.createElement("span");
  badge.className = "sms-draft-badge";
  badge.textContent = "Needs sending";
  head.append(info, badge);

  const body = document.createElement("p");
  body.className = "sms-draft-message";
  body.textContent = draft.message_text || "";

  const actions = document.createElement("div");
  actions.className = "sms-draft-actions";

  const phone = String(draft.orders?.customers?.phone || "").trim();
  if (phone) {
    const sms = document.createElement("button");
    sms.type = "button";
    sms.textContent = "Open SMS";
    sms.addEventListener("click", () => {
      const bodyText = draft.message_text || "";
      window.location.href = `sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(bodyText)}`;
    });
    actions.appendChild(sms);
  } else {
    const noPhone = document.createElement("span");
    noPhone.className = "sms-draft-no-phone";
    noPhone.textContent = "No phone number";
    actions.appendChild(noPhone);
  }

  const mark = document.createElement("button");
  mark.type = "button";
  mark.className = "secondary-button";
  mark.textContent = "Mark as Sent";
  mark.addEventListener("click", async () => {
    mark.disabled = true;
    try {
      const result = await supabase
        .from("sms_update_drafts")
        .update({ sent_marked_at: new Date().toISOString() })
        .eq("id", draft.id)
        .eq("seller_id", (await getCurrentUser()).id);
      if (result.error) throw result.error;
      card.remove();
      const remaining = document.querySelectorAll(".sms-draft-card").length;
      $("updatesCount").textContent = `${remaining} update${remaining === 1 ? "" : "s"}`;
      if (remaining === 0) $("updatesEmptyState").hidden = false;
    } catch (error) {
      mark.disabled = false;
      $("updatesMessage").textContent = error?.message || "Unable to mark the update as sent.";
    }
  });
  actions.appendChild(mark);

  if (draft.order_id) {
    const openOrder = document.createElement("button");
    openOrder.type = "button";
    openOrder.className = "secondary-button";
    openOrder.textContent = "Open Order";
    openOrder.addEventListener("click", () => {
      currentOrderId = draft.order_id;
      currentOrderShowProduction = false;
      navigate("order-detail");
    });
    actions.appendChild(openOrder);
  }

  card.append(head, body, actions);
  return card;
}


async function loadReviews() {
  const user = await getCurrentUser();
  const list = $("reviewsList");
  if (!list) return;
  list.replaceChildren();
  $("reviewsEmptyState").hidden = true;
  $("reviewsMessage").textContent = "";
  try {
    const result = await supabase
      .from("reviews")
      .select("id,order_id,rating,review_text,created_at,orders(order_number,customers(name))")
      .eq("seller_id", user.id)
      .order("created_at", { ascending: false });
    if (result.error) throw result.error;
    const reviews = result.data || [];
    const average = reviews.length ? reviews.reduce((sum, row) => sum + Number(row.rating || 0), 0) / reviews.length : 0;
    $("reviewsAverage").textContent = reviews.length ? `${average.toFixed(1)} / 5` : "—";
    $("reviewsCount").textContent = `${reviews.length} review${reviews.length === 1 ? "" : "s"}`;
    if (!reviews.length) {
      $("reviewsEmptyState").hidden = false;
      return;
    }
    reviews.forEach(review => {
      const card = document.createElement("article");
      card.className = "review-card";
      const head = document.createElement("div");
      head.className = "review-card-head";
      const customer = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = review.orders?.customers?.name || "Customer";
      const meta = document.createElement("span");
      meta.textContent = `Order #${review.orders?.order_number ?? "—"} · ${formatDate(review.created_at)}`;
      customer.append(name, meta);
      const rating = document.createElement("strong");
      rating.className = "review-rating";
      rating.textContent = `${"★".repeat(Number(review.rating || 0))}${"☆".repeat(5 - Number(review.rating || 0))}`;
      head.append(customer, rating);
      card.appendChild(head);
      if (review.review_text) {
        const text = document.createElement("p");
        text.textContent = review.review_text;
        card.appendChild(text);
      }
      list.appendChild(card);
    });
  } catch (error) {
    console.error("Reviews load failed:", error);
    $("reviewsMessage").textContent = "Unable to load reviews right now.";
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

// If the PWA was opened directly from an existing service-worker cache, do not
// depend on the browser firing an online/auth event to start rendering.
queueMicrotask(() => {
  renderApplication().catch(error => console.error("Ordeli startup failed:", error));
});

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
