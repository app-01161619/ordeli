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
let fulfillmentState = null;
let fulfillmentBusy = false;

function getTrackingToken() {
  const pathname = window.location.pathname.replace(/\/+$/, "");
  const queryToken = new URLSearchParams(window.location.search).get("token");
  if (queryToken) return queryToken;

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



function formatEventDate(value) {
  if (!value) return "";
  const d = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(d);
}

function formatEventTime(start, end) {
  const fmt = (v) => v ? new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(new Date(`1970-01-01T${v}`)) : "";
  return `${fmt(start)}${end ? `–${fmt(end)}` : ""}`;
}

function fulfillmentLabel(value) {
  return value === "shop" ? "Pickup at Shop" : value === "location" ? "Pickup at Location" : value === "courier" ? "Courier Delivery" : "Not Selected";
}

function renderFulfillment() {
  const card = $("trackingFulfillmentCard");
  if (!card) return;
  const state = fulfillmentState || {};
  const ready = Boolean(state.production_completed && state.fully_paid && !state.handed_over_at);
  card.hidden = false;
  $("fulfillmentCurrent").textContent = state.fulfillment_type ? fulfillmentLabel(state.fulfillment_type) : "Not selected yet";
  $("fulfillmentRequirement").textContent = ready
    ? "Your order is ready for fulfillment selection."
    : state.handed_over_at
      ? "This order has already been handed over."
      : !state.production_completed
        ? "Fulfillment options will appear after production is completed."
        : "Fulfillment options will appear after payment is fully confirmed.";

  const options = $("fulfillmentOptions");
  const notice = $("fulfillmentNotice");
  const eventPicker = $("fulfillmentEventPicker");
  if (!ready) {
    options.hidden = true; eventPicker.hidden = true; notice.textContent = ""; return;
  }
  options.hidden = false;
  const selected = state.fulfillment_type || "";
  document.querySelectorAll("input[name='fulfillmentType']").forEach(r => r.checked = r.value === selected);
  eventPicker.hidden = selected !== "location";
  const select = $("fulfillmentEventSelect");
  select.replaceChildren();
  const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Choose an event"; select.appendChild(placeholder);
  (state.events || []).forEach((event) => {
    const option = document.createElement("option");
    option.value = event.id;
    option.textContent = `${event.name} · ${formatEventDate(event.event_date)}${event.start_time ? ` · ${formatEventTime(event.start_time, event.end_time)}` : ""}`;
    option.dataset.location = event.location || "";
    select.appendChild(option);
  });
  if (state.event?.id) select.value = state.event.id;
  if (selected === "location" && !state.event?.id && state.events?.length === 0) {
    notice.textContent = "There are no upcoming pickup events available right now.";
  } else if (selected === "courier") {
    notice.textContent = "Thank you for your purchase! Please wait for our customer service team to contact you to arrange your delivery.";
  } else {
    notice.textContent = "";
  }
}

async function loadCustomerFulfillment(publicToken) {
  try {
    const { data, error } = await supabase.rpc("get_customer_fulfillment", { p_public_token: publicToken });
    if (error) throw error;
    fulfillmentState = data || null;
    renderFulfillment();
  } catch (error) {
    console.error("Customer fulfillment load failed:", error);
    fulfillmentState = null;
    renderFulfillment();
  }
}

async function saveCustomerFulfillment() {
  if (fulfillmentBusy) return;
  const token = getTrackingToken();
  if (!token) return;
  const choice = document.querySelector("input[name='fulfillmentType']:checked")?.value || "";
  const eventId = choice === "location" ? $("fulfillmentEventSelect").value : null;
  if (!choice) { $("fulfillmentNotice").textContent = "Choose a fulfillment option."; return; }
  if (choice === "location" && !eventId) { $("fulfillmentNotice").textContent = "Choose a pickup event."; return; }
  fulfillmentBusy = true;
  const button = $("saveFulfillmentButton");
  if (button) { button.disabled = true; button.textContent = "Saving…"; }
  try {
    const { error } = await supabase.rpc("set_customer_fulfillment", { p_public_token: token, p_fulfillment_type: choice, p_event_id: eventId });
    if (error) throw error;
    await loadCustomerTracking(token);
    await loadCustomerFulfillment(token);
    $("fulfillmentNotice").textContent = choice === "courier"
      ? "Thank you for your purchase! Our customer service team will contact you to arrange delivery."
      : `Fulfillment selected: ${fulfillmentLabel(choice)}.`;
  } catch (error) {
    console.error("Customer fulfillment save failed:", error);
    $("fulfillmentNotice").textContent = error?.message || "Unable to save your fulfillment choice.";
  } finally {
    fulfillmentBusy = false;
    if (button) { button.disabled = false; button.textContent = "Save Fulfillment"; }
  }
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
    await loadCustomerFulfillment(publicToken);
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

function bootCustomerTracking() {
  const token = getTrackingToken();
  if (!token) {
    showTrackingError("This tracking link could not be loaded.");
    return;
  }
  loadCustomerTracking(token);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootCustomerTracking, { once: true });
} else {
  bootCustomerTracking();
}


document.querySelectorAll("input[name='fulfillmentType']").forEach((radio) => {
  radio.addEventListener("change", () => {
    const selected = document.querySelector("input[name='fulfillmentType']:checked")?.value;
    $("fulfillmentEventPicker").hidden = selected !== "location";
    if (selected === "courier") $("fulfillmentNotice").textContent = "Thank you for your purchase! Please wait for our customer service team to contact you to arrange your delivery.";
    else if (selected !== "location") $("fulfillmentNotice").textContent = "";
  });
});
$("saveFulfillmentButton")?.addEventListener("click", saveCustomerFulfillment);
$("fulfillmentEventSelect")?.addEventListener("change", () => {
  const option = $("fulfillmentEventSelect").selectedOptions[0];
  const location = option?.dataset.location || "";
  if (location) $("fulfillmentNotice").textContent = location;
});
