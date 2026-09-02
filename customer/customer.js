import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://kbgdxhshxkhuelbxlggc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_KJDx4oVgNF6z_5SYvyI-uw_h58jlimx";

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  }
);

const $ = (id) => document.getElementById(id);
let trackingPayload = null;
let trackingOrderVisible = false;
let trackingBooted = false;

function getTrackingToken() {
  const pathname = window.location.pathname.replace(/\/+$/, "");
  const match = pathname.match(/^\/t\/([^/]+)$/i);
  if (match) {
    try { return decodeURIComponent(match[1]); }
    catch { return null; }
  }
  return window.__ORDELI_TRACKING_TOKEN || null;
}

function formatPrice(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency", currency: "PHP"
  }).format(Number(value) || 0);
}

function trackingProductionStatusLabel(value) {
  switch (value) {
    case "completed": return "Completed";
    case "cancelled": return "Cancelled";
    case "pending": return "Pending";
    default: return "In Progress";
  }
}

function trackingPaymentStatusLabel(value) {
  switch (value) {
    case "fully_paid": return "Fully Paid";
    case "partially_paid": return "Partially Paid";
    case "pending_verification": return "Payment Pending Verification";
    case "rejected": return "Payment Proof Rejected";
    default: return "Unpaid";
  }
}

function showTrackingContent() {
  $("trackingLoadingState").hidden = true;
  $("trackingErrorState").hidden = true;
  $("trackingContent").hidden = false;
}

function showTrackingError(message) {
  $("trackingLoadingState").hidden = true;
  $("trackingContent").hidden = true;
  $("trackingErrorState").hidden = false;
  $("trackingErrorMessage").textContent = message || "This tracking link could not be loaded.";
}

function renderTrackingStages(stages) {
  const list = $("trackingStageList");
  list.replaceChildren();
  if (!stages.length) {
    const empty = document.createElement("p");
    empty.className = "tracking-stage-empty";
    empty.textContent = "No production stages have been added yet.";
    list.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  stages.forEach((stage) => {
    const row = document.createElement("div");
    row.className = `tracking-stage-row is-${stage.status || "upcoming"}`;
    const icon = document.createElement("span");
    icon.className = "tracking-stage-icon";
    icon.textContent = stage.status === "finished" ? "✓" : stage.status === "in_progress" ? "→" : "○";
    const body = document.createElement("div");
    body.className = "tracking-stage-body";
    const name = document.createElement("strong");
    name.textContent = stage.name || `Stage ${stage.stage_order || ""}`;
    const status = document.createElement("span");
    status.textContent = stage.status === "finished" ? "Finished" : stage.status === "in_progress" ? "In Progress" : "Upcoming";
    body.append(name, status);
    row.append(icon, body);
    fragment.appendChild(row);
  });
  list.appendChild(fragment);
}

function renderTrackingOrderItems(items) {
  const list = $("trackingOrderItems");
  list.replaceChildren();
  const fragment = document.createDocumentFragment();
  items.forEach((entry) => {
    const row = document.createElement("div");
    row.className = `tracking-order-item ${entry.cancelled ? "is-cancelled" : ""}`;
    const left = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = entry.product_name || "Product";
    const quantity = document.createElement("span");
    quantity.textContent = ` × ${Number(entry.quantity) || 0}`;
    left.append(name, quantity);
    const status = document.createElement("span");
    status.textContent = trackingProductionStatusLabel(entry.production_status);
    row.append(left, status);
    fragment.appendChild(row);
  });
  list.appendChild(fragment);
}

function renderCustomerTracking(payload) {
  showTrackingContent();
  const shop = payload?.shop || {};
  const order = payload?.order || {};
  const item = payload?.item || {};
  const payment = payload?.payment || {};

  $("trackingShopName").textContent = shop.name || "Shop";
  $("trackingOrderNumber").textContent = `#${order.order_number ?? "—"}`;
  $("trackingProductName").textContent = item.product_name || "Product";
  $("trackingProductQuantity").textContent = `Quantity: ${Number(item.quantity) || 0}`;

  const itemCancelled = Boolean(item.cancelled_at);
  const orderCancelled = Boolean(order.cancelled_at);
  const productionStatus = itemCancelled ? "Cancelled" : item.production_completed ? "Completed" : "In Progress";
  $("trackingItemStatus").textContent = orderCancelled ? "Order Cancelled" : productionStatus;
  $("trackingItemStatus").className = `tracking-status-badge ${
    orderCancelled || itemCancelled ? "is-cancelled" : productionStatus === "Completed" ? "is-complete" : ""
  }`;

  if (orderCancelled || itemCancelled) {
    $("trackingProductionSummary").textContent = "This order item is no longer active.";
  } else if (item.production_completed) {
    $("trackingProductionSummary").textContent = "All production stages for this item are finished.";
  } else if (!item.production_stages?.length) {
    $("trackingProductionSummary").textContent = "Production stages have not been configured yet.";
  } else {
    $("trackingProductionSummary").textContent = "The production timeline updates as each stage is finished.";
  }

  renderTrackingStages(item.production_stages || []);
  $("trackingPaymentTotal").textContent = formatPrice(payment.total);
  $("trackingPaymentPaid").textContent = formatPrice(payment.paid);
  $("trackingPaymentRemaining").textContent = formatPrice(payment.remaining);
  $("trackingPaymentStatusText").textContent = trackingPaymentStatusLabel(payment.status);
  renderTrackingOrderItems(payload?.order_items || []);
  $("trackingOrderCard").hidden = !trackingOrderVisible;
  $("trackingViewOrderButton").textContent = trackingOrderVisible ? "Hide My Order" : "View My Order";
}

async function loadCustomerTracking(publicToken) {
  trackingPayload = null;
  trackingOrderVisible = false;
  $("trackingLoadingState").hidden = false;
  $("trackingErrorState").hidden = true;
  $("trackingContent").hidden = true;
  try {
    const { data, error } = await supabase.rpc("get_customer_tracking", { p_public_token: publicToken });
    if (error) throw error;
    if (!data) throw new Error("Tracking information is not available.");
    trackingPayload = { ...data, _token: publicToken };
    renderCustomerTracking(trackingPayload);
  } catch (error) {
    console.error("Customer tracking load failed:", error);
    showTrackingError(error?.message || "This tracking link could not be loaded.");
  }
}

$("trackingRefreshButton").addEventListener("click", () => {
  const token = getTrackingToken();
  if (token) loadCustomerTracking(token);
});

$("trackingViewOrderButton").addEventListener("click", () => {
  trackingOrderVisible = !trackingOrderVisible;
  if (trackingPayload) renderCustomerTracking(trackingPayload);
});

async function bootCustomerTracking() {
  if (trackingBooted) return;
  trackingBooted = true;

  const token = getTrackingToken();
  console.log("Ordeli customer tracking boot", {
    pathname: window.location.pathname,
    hasToken: Boolean(token)
  });

  if (!token) {
    showTrackingError("This tracking link could not be loaded.");
    return;
  }

  await loadCustomerTracking(token);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootCustomerTracking, { once: true });
} else {
  bootCustomerTracking();
}
