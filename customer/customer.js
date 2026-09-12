import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/+esm";

const SUPABASE_URL = "https://kbgdxhshxkhuelbxlggc.supabase.co";
const SUPABASE_KEY = "sb_publishable_KJDx4oVgNF6z_5SYvyI-uw_h58jlimx";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const $ = (id) => document.getElementById(id);
let token = null;
let payload = null;
let fulfillment = null;
let paymentContext = null;
let reviewState = null;
let cancellationState = null;
let paymentFormOpen = false;
let paymentBusy = false;
let fulfillmentBusy = false;
let rescheduleBusy = false;
let reviewBusy = false;
let cancelBusy = false;
let selectedRating = 0;
let paymentPreviewUrl = null;
let lastLoadId = 0;

function getToken() {
  const path = location.pathname.replace(/\/+$/, "");
  const query = new URLSearchParams(location.search).get("token");
  if (query) return query.trim();
  const hash = new URLSearchParams(location.hash.replace(/^#/, "")).get("token");
  if (hash) return hash.trim();
  const match = path.match(/^\/t\/([^/]+)$/i);
  if (match) {
    try { return decodeURIComponent(match[1]).trim(); } catch { return null; }
  }
  return window.__ORDELI_TRACKING_TOKEN || null;
}

function money(v) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(v) || 0);
}

function showContent() {
  $("loadingCard").hidden = true;
  $("errorCard").hidden = true;
  $("content").hidden = false;
}

function showError(message) {
  $("loadingCard").hidden = true;
  $("content").hidden = true;
  $("errorCard").hidden = false;
  $("errorMessage").textContent = message || "This tracking link could not be loaded.";
}

function statusLabel(v) {
  if (v === "completed") return "Completed";
  if (v === "cancelled") return "Cancelled";
  return "In Progress";
}

function paymentLabel(v) {
  return ({ fully_paid: "Fully Paid", partially_paid: "Partially Paid", pending_verification: "Payment Pending Verification", rejected: "Payment Proof Rejected", unpaid: "Unpaid" })[v] || "Unpaid";
}

function formatDate(v) {
  if (!v) return "";
  const d = new Date(`${v}T00:00:00`);
  return new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(d);
}

function formatTime(v) {
  if (!v) return "";
  return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(new Date(`1970-01-01T${v}`));
}

function fulfillmentLabel(v) {
  return ({ shop: "Pickup at Shop", location: "Pickup at Location", courier: "Courier Delivery" })[v] || "Not selected";
}

function revokePreview() {
  if (paymentPreviewUrl) URL.revokeObjectURL(paymentPreviewUrl);
  paymentPreviewUrl = null;
  const image = $("paymentPreview");
  if (image) image.removeAttribute("src");
  $("paymentPreviewWrap").hidden = true;
}

function renderStages(stages) {
  const list = $("stageList");
  list.replaceChildren();
  if (!Array.isArray(stages) || stages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No production stages have been configured yet.";
    list.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const stage of stages) {
    const row = document.createElement("div");
    row.className = `stage-row ${stage.status || "upcoming"}`;
    const icon = document.createElement("span");
    icon.className = "stage-icon";
    icon.textContent = stage.status === "finished" ? "✓" : stage.status === "in_progress" ? "→" : "○";
    const body = document.createElement("div");
    const name = document.createElement("div");
    name.className = "stage-name";
    name.textContent = stage.name || `Stage ${stage.stage_order ?? ""}`;
    const status = document.createElement("span");
    status.className = "stage-status";
    status.textContent = stage.status === "finished" ? "Finished" : stage.status === "in_progress" ? "In Progress" : "Upcoming";
    body.append(name, status);

    // The control exists only when the tracking API explicitly says a photo exists.
    if (stage.status === "finished" && stage.has_photo === true) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tracking-photo-button";
      button.textContent = "View Photo";
      button.addEventListener("click", () => openStagePhoto(stage.stage_order, button));
      body.appendChild(button);
    }
    row.append(icon, body);
    fragment.appendChild(row);
  }
  list.appendChild(fragment);
}

async function openStagePhoto(stageOrder, button) {
  if (!token || !stageOrder || button?.disabled) return;
  button.disabled = true;
  const old = button.textContent;
  button.textContent = "Loading…";
  try {
    let data = null;
    const response = await fetch(`/api/customer-stage-proof?token=${encodeURIComponent(token)}&stage_order=${Number(stageOrder)}`, { headers: { Accept: "application/json" }, cache: "no-store" }).catch(() => null);
    if (response?.ok) data = await response.json().catch(() => null);
    if (!data?.available || !data?.url) {
      const fallback = await supabase.rpc("get_customer_stage_proof", { p_public_token: token, p_stage_order: Number(stageOrder) });
      if (fallback.error) throw fallback.error;
      data = fallback.data;
    }
    if (!data?.available || !data?.url) throw new Error("No proof photo is available for this stage.");
    $("photoCaption").textContent = `${data.stage_name || `Stage ${stageOrder}`} · Production Proof`;
    const image = $("photoImage");
    image.src = data.url;
    const dialog = $("photoDialog");
    if (dialog.open) dialog.close();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.hidden = false;
  } catch (e) {
    console.error(e);
    alert(e?.message || "Unable to open the proof photo.");
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}

function closePhoto() {
  const dialog = $("photoDialog");
  if (!dialog) return;
  if (dialog.open && typeof dialog.close === "function") dialog.close();
  else dialog.hidden = true;
}

function renderOrderItems(items) {
  const list = $("orderItems");
  list.replaceChildren();
  for (const entry of Array.isArray(items) ? items : []) {
    const row = document.createElement("div");
    row.className = "order-item";
    const left = document.createElement("span");
    left.textContent = `${entry.product_name || "Product"} × ${Number(entry.quantity) || 0}`;
    const right = document.createElement("span");
    right.className = "status";
    right.textContent = entry.cancelled ? "Cancelled" : statusLabel(entry.production_status);
    row.append(left, right);
    list.appendChild(row);
  }
}

function renderMain(data) {
  payload = data;
  showContent();
  const shop = data?.shop || {};
  const order = data?.order || {};
  const item = data?.item || {};
  const payment = data?.payment || {};
  $("shopName").textContent = shop.name || "Shop";
  $("shopAddress").textContent = shop.address || "";
  $("orderNumber").textContent = `#${order.order_number ?? "—"}`;
  $("productName").textContent = item.product_name || "Product";
  $("productQuantity").textContent = `Quantity: ${Number(item.quantity) || 0}`;
  const itemStatus = item.cancelled_at ? "Cancelled" : item.production_completed ? "Completed" : "In Progress";
  const badge = $("itemStatus");
  badge.textContent = itemStatus;
  badge.className = `status-badge ${itemStatus === "Completed" ? "complete" : itemStatus === "Cancelled" ? "cancelled" : ""}`;
  $("productionSummary").textContent = item.cancelled_at ? "This item has been cancelled." : item.production_completed ? "All stages for this product are finished." : "Production updates appear as stages are finished.";
  renderStages(item.production_stages || []);

  const orderItems = Array.isArray(data.order_items) ? data.order_items : [];
  const multi = orderItems.length > 1;
  $("viewOrderButton").hidden = !multi;
  if (!multi) $("orderCard").hidden = true;
  renderOrderItems(orderItems);

  $("paymentTotal").textContent = money(payment.total);
  $("paymentPaid").textContent = money(payment.paid);
  $("paymentRemaining").textContent = money(payment.remaining);
  $("paymentStatus").textContent = paymentLabel(payment.status);

  paymentContext = { ...(paymentContext || {}), eligible: Number(payment.remaining) > 0, remaining: Number(payment.remaining) || 0 };
  renderPayment();
}

function renderPayment() {
  const remaining = Number(paymentContext?.remaining ?? payload?.payment?.remaining ?? 0);
  const hasBalance = Number.isFinite(remaining) && remaining > 0;
  const add = $("addPaymentButton");
  const form = $("paymentForm");
  add.hidden = !hasBalance;
  add.disabled = false;
  $("amountHint").textContent = hasBalance ? `Maximum for this payment: ${money(remaining)}` : "";

  // Original customer spec: payment proof is an optional customer action when a balance remains.
  // It is intentionally separate from production/fulfillment state.
  const pending = Boolean(paymentContext?.pending_verification || payload?.payment?.status === "pending_verification");
  if (pending && paymentFormOpen) {
    paymentFormOpen = false;
    form.hidden = true;
  }
  if (!hasBalance || pending) {
    if (!paymentFormOpen) form.hidden = true;
    if (pending) $("paymentMessage").textContent = "A payment proof is already pending seller verification.";
    return;
  }
  if (paymentFormOpen) form.hidden = false;
}

function openPaymentForm() {
  if (!payload) return;
  const remaining = Number(payload?.payment?.remaining ?? 0);
  if (!Number.isFinite(remaining) || remaining <= 0) return;
  paymentFormOpen = true;
  paymentContext = { ...(paymentContext || {}), eligible: true, remaining };
  $("paymentForm").hidden = false;
  $("paymentMessage").textContent = "Upload the screenshot and enter the amount you paid.";
  requestAnimationFrame(() => {
    $("paymentAmount")?.focus();
    $("paymentForm")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function clearPaymentForm() {
  paymentFormOpen = false;
  revokePreview();
  if ($("paymentFile")) $("paymentFile").value = "";
  if ($("paymentAmount")) $("paymentAmount").value = "";
  $("paymentMessage").textContent = "";
  $("paymentForm").hidden = true;
}

function handlePaymentFile() {
  const file = $("paymentFile")?.files?.[0];
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    $("paymentFile").value = "";
    revokePreview();
    $("paymentMessage").textContent = "Please choose a JPG, PNG, or WebP image.";
    return;
  }
  if (file.size <= 0 || file.size > 8 * 1024 * 1024) {
    $("paymentFile").value = "";
    revokePreview();
    $("paymentMessage").textContent = "Please choose an image smaller than 8 MB.";
    return;
  }
  revokePreview();
  paymentPreviewUrl = URL.createObjectURL(file);
  $("paymentPreview").src = paymentPreviewUrl;
  $("paymentPreviewWrap").hidden = false;
  $("paymentMessage").textContent = `Selected: ${file.name}`;
}

async function submitPayment() {
  if (paymentBusy) return;
  const file = $("paymentFile")?.files?.[0];
  const amount = Number($("paymentAmount")?.value);
  const remaining = Number(paymentContext?.remaining ?? payload?.payment?.remaining ?? 0);
  if (!file) { $("paymentMessage").textContent = "Upload your payment proof screenshot first."; return; }
  if (!Number.isFinite(amount) || amount <= 0) { $("paymentMessage").textContent = "Enter the amount you paid."; return; }
  if (!Number.isFinite(remaining) || remaining <= 0) { $("paymentMessage").textContent = "There is no remaining balance."; return; }
  if (amount > remaining + 0.000001) { $("paymentMessage").textContent = `Amount cannot exceed ${money(remaining)}.`; return; }

  paymentBusy = true;
  $("submitPaymentButton").disabled = true;
  $("choosePaymentButton").disabled = true;
  $("paymentAmount").disabled = true;
  $("paymentMessage").textContent = "Submitting payment proof…";
  try {
    const form = new FormData();
    form.set("token", token);
    form.set("amount", amount.toFixed(2));
    form.set("file", file, file.name || "payment-proof");
    const response = await fetch("/api/customer-payment-proof", { method: "POST", body: form, cache: "no-store" });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) throw new Error(result?.error || "Unable to submit payment proof.");
    clearPaymentForm();
    await loadTracking();
    await loadPaymentContext();
  } catch (e) {
    console.error(e);
    $("paymentMessage").textContent = e?.message || "Unable to submit payment proof.";
    paymentFormOpen = true;
    $("paymentForm").hidden = false;
  } finally {
    paymentBusy = false;
    $("submitPaymentButton").disabled = false;
    $("choosePaymentButton").disabled = false;
    $("paymentAmount").disabled = false;
  }
}

function renderFulfillment() {
  const card = $("fulfillmentCard");
  const state = fulfillment || {};
  const readyForFulfillment = Boolean(state.production_completed);
  const fullyPaid = Boolean(state.fully_paid);
  const handedOver = Boolean(state.handed_over_at);
  card.hidden = !readyForFulfillment;
  $("unclaimedCard").hidden = !(state.pickup_status === "unclaimed" && state.fulfillment_type === "location" && !handedOver);
  $("courierCard").hidden = state.fulfillment_type !== "courier" || handedOver;
  $("receivedCard").hidden = !handedOver;

  if (!readyForFulfillment) return;
  if (handedOver) {
    $("fulfillmentMessage").textContent = "Your order has been handed over.";
    return;
  }
  if (!fullyPaid) {
    $("fulfillmentMessage").textContent = "Fulfillment options will appear after payment is fully confirmed.";
    $("fulfillmentChoices").hidden = true;
    $("eventPicker").hidden = true;
    $("saveFulfillmentButton").hidden = true;
    return;
  }

  $("fulfillmentMessage").textContent = "Choose how you would like to receive your order.";
  $("fulfillmentChoices").hidden = false;
  $("saveFulfillmentButton").hidden = false;
  $("shopPickupHint").textContent = payload?.shop?.address ? payload.shop.address : "Pick up from the seller's shop.";
  const selected = state.fulfillment_type || "";
  document.querySelectorAll("input[name='fulfillment']").forEach(r => { r.checked = r.value === selected; });
  $("selectedFulfillment").hidden = !selected;
  if (selected) $("selectedFulfillment").textContent = fulfillmentLabel(selected);
  renderEventOptions();
}

function fillEventSelect(select, excludeId = null) {
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose an event";
  select.appendChild(placeholder);
  for (const event of Array.isArray(fulfillment?.events) ? fulfillment.events : []) {
    if (!event?.id || event.id === excludeId) continue;
    const option = document.createElement("option");
    option.value = event.id;
    option.textContent = `${event.name} · ${formatDate(event.event_date)}${event.start_time ? ` · ${formatTime(event.start_time)}${event.end_time ? `–${formatTime(event.end_time)}` : ""}` : ""}`;
    option.dataset.location = event.location || "";
    select.appendChild(option);
  }
}

function renderEventOptions() {
  const selected = document.querySelector("input[name='fulfillment']:checked")?.value || fulfillment?.fulfillment_type || "";
  $("eventPicker").hidden = selected !== "location";
  if (selected === "location") {
    fillEventSelect($("eventSelect"));
    if (fulfillment?.event?.id) $("eventSelect").value = fulfillment.event.id;
  }
  fillEventSelect($("rescheduleEventSelect"), fulfillment?.event?.id || null);
}

async function saveFulfillment() {
  if (fulfillmentBusy) return;
  const choice = document.querySelector("input[name='fulfillment']:checked")?.value || "";
  const eventId = choice === "location" ? $("eventSelect").value : null;
  if (!choice) { $("fulfillmentNotice").textContent = "Choose a fulfillment option."; return; }
  if (choice === "location" && !eventId) { $("fulfillmentNotice").textContent = "Choose a pickup event."; return; }
  fulfillmentBusy = true;
  $("saveFulfillmentButton").disabled = true;
  $("fulfillmentNotice").textContent = "Saving…";
  try {
    const { error } = await supabase.rpc("set_customer_fulfillment", { p_public_token: token, p_fulfillment_type: choice, p_event_id: eventId });
    if (error) throw error;
    await loadTracking();
    await loadFulfillment();
    $("fulfillmentNotice").textContent = choice === "courier" ? "Please wait for the seller to contact you to arrange delivery." : "Fulfillment updated successfully.";
  } catch (e) {
    console.error(e);
    $("fulfillmentNotice").textContent = e?.message || "Unable to save your fulfillment choice.";
  } finally {
    fulfillmentBusy = false;
    $("saveFulfillmentButton").disabled = false;
  }
}

async function reschedulePickup() {
  if (rescheduleBusy) return;
  const eventId = $("rescheduleEventSelect").value;
  if (!eventId) { $("rescheduleMessage").textContent = "Choose a new pickup event."; return; }
  rescheduleBusy = true;
  $("rescheduleButton").disabled = true;
  $("switchCourierButton").disabled = true;
  $("rescheduleMessage").textContent = "Updating your pickup schedule…";
  try {
    const { error } = await supabase.rpc("reschedule_customer_pickup", { p_public_token: token, p_new_event_id: eventId });
    if (error) throw error;
    await loadTracking();
    await loadFulfillment();
    $("rescheduleMessage").textContent = "Pickup rescheduled successfully.";
  } catch (e) {
    console.error(e);
    $("rescheduleMessage").textContent = e?.message || "Unable to reschedule pickup.";
  } finally {
    rescheduleBusy = false;
    $("rescheduleButton").disabled = false;
    $("switchCourierButton").disabled = false;
  }
}

async function switchCourier() {
  if (rescheduleBusy) return;
  if (!confirm("Switch this order to Courier Delivery?")) return;
  rescheduleBusy = true;
  $("switchCourierButton").disabled = true;
  $("rescheduleMessage").textContent = "Switching to Courier Delivery…";
  try {
    const { error } = await supabase.rpc("set_customer_fulfillment", { p_public_token: token, p_fulfillment_type: "courier", p_event_id: null });
    if (error) throw error;
    await loadTracking();
    await loadFulfillment();
    $("rescheduleMessage").textContent = "Courier Delivery selected.";
  } catch (e) {
    console.error(e);
    $("rescheduleMessage").textContent = e?.message || "Unable to switch to Courier Delivery.";
  } finally {
    rescheduleBusy = false;
    $("switchCourierButton").disabled = false;
  }
}

function renderReview() {
  const box = $("reviewCard");
  const state = reviewState || {};
  box.hidden = !state.available;
  if (!state.available) return;
  if (state.submitted) {
    $("reviewHint").textContent = "Thank you. Your review has been submitted.";
    $("submitReviewButton").hidden = true;
    $("reviewText").disabled = true;
    document.querySelectorAll("#reviewStars button").forEach(b => b.disabled = true);
    setRating(Number(state.rating || 0));
    if (state.review_text) $("reviewText").value = state.review_text;
    return;
  }
  $("reviewHint").textContent = state.reason || "Share your experience with the seller.";
  $("submitReviewButton").hidden = false;
}

function setRating(n) {
  selectedRating = Number(n) || 0;
  document.querySelectorAll("#reviewStars button").forEach(b => b.classList.toggle("selected", Number(b.dataset.rating) <= selectedRating));
}

async function submitReview() {
  if (reviewBusy) return;
  if (!selectedRating) { $("reviewMessage").textContent = "Choose a rating from 1 to 5 stars."; return; }
  reviewBusy = true;
  $("submitReviewButton").disabled = true;
  try {
    const { error } = await supabase.rpc("submit_customer_review", { p_public_token: token, p_rating: selectedRating, p_review_text: $("reviewText").value.trim() || null });
    if (error) throw error;
    await loadPostPurchase();
    $("reviewMessage").textContent = "Thank you for your review.";
  } catch (e) {
    console.error(e);
    $("reviewMessage").textContent = e?.message || "Unable to submit your review.";
  } finally {
    reviewBusy = false;
    $("submitReviewButton").disabled = false;
  }
}

function renderCancellation() {
  const box = $("cancelCard");
  const state = cancellationState || {};
  box.hidden = !state.available;
  if (!state.available) return;
  $("cancelHint").textContent = state.hint || "This item is still eligible for customer cancellation.";
  if (state.cancelled) {
    $("cancelItemButton").hidden = true;
    $("cancelHint").textContent = "This item has been cancelled.";
  }
}

async function cancelItem() {
  if (cancelBusy) return;
  if (!confirm("Cancel this product from the order? This cannot be undone.")) return;
  cancelBusy = true;
  $("cancelItemButton").disabled = true;
  $("cancelMessage").textContent = "Cancelling…";
  try {
    const { error } = await supabase.rpc("cancel_customer_order_item", { p_public_token: token, p_reason: "Customer cancelled from tracking page" });
    if (error) throw error;
    await loadTracking();
    await loadPostPurchase();
    $("cancelMessage").textContent = "This item has been cancelled.";
  } catch (e) {
    console.error(e);
    $("cancelMessage").textContent = e?.message || "Unable to cancel this item.";
  } finally {
    cancelBusy = false;
    $("cancelItemButton").disabled = false;
  }
}

async function loadTracking() {
  const id = ++lastLoadId;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_customer_tracking`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ p_public_token: token }),
      cache: "no-store",
      signal: controller.signal
    });
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    if (!response.ok) throw new Error(data?.message || data?.details || `Tracking request failed (${response.status}).`);
    if (!data) throw new Error("Tracking information is not available.");
    if (id !== lastLoadId) return;
    renderMain(data);
    await Promise.allSettled([loadFulfillment(), loadPostPurchase(), loadPaymentContext()]);
  } catch (e) {
    if (id !== lastLoadId) return;
    console.error("Customer tracking load failed:", e);
    showError(e?.name === "AbortError" ? "The tracking request timed out. Please try again." : e?.message || "This tracking link could not be loaded.");
  } finally {
    clearTimeout(timeout);
  }
}

async function loadFulfillment() {
  try {
    const { data, error } = await supabase.rpc("get_customer_fulfillment", { p_public_token: token });
    if (error) throw error;
    fulfillment = data || null;
  } catch (e) {
    console.error("Customer fulfillment load failed:", e);
    fulfillment = null;
  }
  renderFulfillment();
}

async function loadPaymentContext() {
  try {
    const { data, error } = await supabase.rpc("get_customer_payment_proof", { p_public_token: token });
    if (error) throw error;
    const remaining = Number(payload?.payment?.remaining ?? 0);
    paymentContext = { ...(data || {}), remaining, eligible: remaining > 0 };
  } catch (e) {
    console.error("Customer payment context load failed:", e);
    const remaining = Number(payload?.payment?.remaining ?? 0);
    paymentContext = { ...(paymentContext || {}), remaining, eligible: remaining > 0 };
  }
  renderPayment();
}

async function loadPostPurchase() {
  try {
    const { data, error } = await supabase.rpc("get_customer_post_purchase_actions", { p_public_token: token });
    if (error) throw error;
    reviewState = data?.review || null;
    cancellationState = data?.cancellation || null;
  } catch (e) {
    console.error("Customer post-purchase actions load failed:", e);
    reviewState = null;
    cancellationState = null;
  }
  renderReview();
  renderCancellation();
}

$("refreshButton").addEventListener("click", () => loadTracking());
$("retryButton").addEventListener("click", () => loadTracking());
$("viewOrderButton").addEventListener("click", () => {
  const card = $("orderCard");
  card.hidden = !card.hidden;
  $("viewOrderButton").textContent = card.hidden ? "View My Order" : "Hide My Order";
});
$("addPaymentButton").addEventListener("click", openPaymentForm);
$("choosePaymentButton").addEventListener("click", () => $("paymentFile").click());
$("paymentFile").addEventListener("change", handlePaymentFile);
$("removePaymentPhoto").addEventListener("click", () => { $("paymentFile").value = ""; revokePreview(); $("paymentMessage").textContent = ""; });
$("cancelPaymentButton").addEventListener("click", clearPaymentForm);
$("submitPaymentButton").addEventListener("click", submitPayment);
$("saveFulfillmentButton").addEventListener("click", saveFulfillment);
$("rescheduleButton").addEventListener("click", reschedulePickup);
$("switchCourierButton").addEventListener("click", switchCourier);
$("cancelItemButton").addEventListener("click", cancelItem);
$("submitReviewButton").addEventListener("click", submitReview);
document.querySelectorAll("#reviewStars button").forEach(b => b.addEventListener("click", () => setRating(b.dataset.rating)));
document.querySelectorAll("input[name='fulfillment']").forEach(r => r.addEventListener("change", () => renderEventOptions()));
$("closePhotoButton").addEventListener("click", closePhoto);
$("photoDialog").addEventListener("cancel", (e) => { e.preventDefault(); closePhoto(); });
$("photoDialog").addEventListener("click", (e) => { if (e.target === $("photoDialog")) closePhoto(); });

function boot() {
  token = getToken();
  if (!token) { showError("This tracking link is invalid or incomplete."); return; }
  loadTracking();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
