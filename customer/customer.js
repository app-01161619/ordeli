import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/+esm";

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
let paymentProofState = null;
let paymentProofBusy = false;
let customerReviewState = null;
let selectedReviewRating = 0;
let customerReviewBusy = false;
let customerCancellationState = null;
let customerCancellationBusy = false;
let customerRescheduleBusy = false;
let paymentProofPreviewUrl = null;

function getTrackingToken() {
  const pathname = window.location.pathname.replace(/\/+$/, "");
  const queryToken = new URLSearchParams(window.location.search).get("token");
  if (queryToken) return queryToken;

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const hashToken = hashParams.get("token");
  if (hashToken) return hashToken;

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

function formatWholePrice(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency", currency: "PHP", maximumFractionDigits: 0
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

function getTrackingStageStatus(stage) {
  return String(stage?.status || stage?.production_status || "").toLowerCase().replace(/-/g, "_");
}

function isTrackingStageFinished(stage) {
  return ["finished", "complete", "completed", "done"].includes(getTrackingStageStatus(stage));
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
    const stageStatus = getTrackingStageStatus(stage) || "upcoming";
    const stageFinished = isTrackingStageFinished(stage);
    const row = document.createElement("div");
    row.className = `tracking-stage-row is-${stageStatus}`;
    const icon = document.createElement("span");
    icon.className = "tracking-stage-icon";
    icon.textContent = stageFinished ? "✓" : stageStatus === "in_progress" ? "→" : "○";
    const body = document.createElement("div");
    body.className = "tracking-stage-body";
    const name = document.createElement("strong");
    name.textContent = stage.name || `Stage ${stage.stage_order || ""}`;
    const status = document.createElement("span");
    status.textContent = stageFinished ? "Finished" : stageStatus === "in_progress" ? "In Progress" : "Upcoming";
    body.append(name, status);

    if (stageFinished) addCustomerProofButtonIfAvailable(stage, body);

    row.append(icon, body);
    fragment.appendChild(row);
  });
  list.appendChild(fragment);
}

async function addCustomerProofButtonIfAvailable(stage, body) {
  const token = getTrackingToken();
  if (!token || !stage?.stage_order || body.dataset.proofChecked === "1") return;
  body.dataset.proofChecked = "1";
  try {
    const response = await fetch(`/api/customer-stage-proof?token=${encodeURIComponent(token)}&stage_order=${encodeURIComponent(Number(stage.stage_order))}`, {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.available || !data.url) return;
    const proofButton = document.createElement("button");
    proofButton.type = "button";
    proofButton.className = "tracking-photo-button";
    proofButton.textContent = "View Photo";
    proofButton.addEventListener("click", () => viewCustomerProductionProof(stage.stage_order, proofButton));
    body.appendChild(proofButton);
  } catch (error) {
    console.warn("Customer proof availability check failed:", error);
  }
}


async function viewCustomerProductionProof(stageOrder, button) {
  const token = getTrackingToken();
  if (!token || !stageOrder || !button) return;
  if (button.dataset.loading === "1") return;

  button.dataset.loading = "1";
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Loading Photo…";
  try {
    let data = null;
    try {
      const endpoint = `/api/customer-stage-proof?token=${encodeURIComponent(token)}&stage_order=${encodeURIComponent(Number(stageOrder))}`;
      const workerResponse = await fetch(endpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      data = await workerResponse.json().catch(() => null);
    } catch (workerError) {
      console.warn("Customer proof Worker unavailable.", workerError);
    }

    if (!data?.available || !data?.url) {
      throw new Error(data?.error || "No proof photo is available for this stage.");
    }
    const viewer = $("customerPhotoViewer");
    const image = $("customerPhotoViewerImage");
    const caption = $("customerPhotoViewerCaption");
    if (image) {
      image.alt = "Loading production proof photo";
      image.onerror = () => {
        image.removeAttribute("src");
        image.alt = "Production proof photo could not be loaded";
        if (caption) caption.textContent = "The production proof photo could not be loaded.";
      };
      image.onload = () => {
        image.alt = "Production proof photo";
      };
      image.src = data.url;
    }
    if (caption) caption.textContent = `${data.stage_name || `Stage ${stageOrder}`} · Production proof`;
    if (viewer?.showModal) viewer.showModal();
    else if (viewer) viewer.hidden = false;
  } catch (error) {
    console.error("Customer production proof failed:", error);
    alert(error?.message || "Unable to open the proof photo.");
  } finally {
    button.dataset.loading = "0";
    button.disabled = false;
    button.textContent = original;
  }
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

function moveWholeOrderCards(orderItemCount) {
  const orderCard = $("trackingOrderCard");
  const summaryCards = $("trackingOrderSummaryCards");
  const fulfillmentCard = $("trackingFulfillmentCard");
  const paymentCard = $("trackingPaymentCard");
  if (!orderCard || !summaryCards || !fulfillmentCard || !paymentCard) return;

  if (orderItemCount > 1) {
    if (fulfillmentCard.parentElement !== summaryCards) summaryCards.appendChild(fulfillmentCard);
    if (paymentCard.parentElement !== summaryCards) summaryCards.appendChild(paymentCard);
  } else {
    const content = $("trackingContent");
    const noticeCard = $("trackingFulfillmentNoticeCard");
    const rescheduleBox = $("customerRescheduleBox");
    const reviewBox = $("customerReviewBox");
    const cancellationBox = $("customerCancellationBox");
    const viewButton = $("trackingViewOrderButton");
    if (content) {
      const anchor = viewButton || noticeCard || rescheduleBox || reviewBox || cancellationBox;
      if (anchor) {
        content.insertBefore(fulfillmentCard, anchor);
        content.insertBefore(paymentCard, anchor);
      } else {
        content.append(fulfillmentCard, paymentCard);
      }
    }
    summaryCards.replaceChildren();
  }
}

function renderFulfillment() {
  const card = $("trackingFulfillmentCard");
  if (!card) return;
  const state = fulfillmentState || {};
  const orderItemCount = Array.isArray(trackingPayload?.order_items) ? trackingPayload.order_items.length : 1;
  moveWholeOrderCards(orderItemCount);
  renderCustomerReschedule();

  const productionReady = Boolean(state.production_completed && !state.handed_over_at);
  const readyForSelection = Boolean(productionReady && state.fully_paid);
  const statusCard = $("trackingFulfillmentNoticeCard");
  const statusTitle = $("trackingFulfillmentNoticeTitle");
  const statusText = $("trackingFulfillmentNoticeText");

  if (statusCard && statusTitle && statusText) {
    if (state.handed_over_at) {
      statusCard.hidden = false;
      statusTitle.textContent = "Order Received";
      statusText.textContent = "Your order has been handed over. Thank you for your purchase!";
    } else if (state.pickup_status === "unclaimed") {
      statusCard.hidden = false;
      statusTitle.textContent = "Pickup was unclaimed";
      statusText.textContent = "You can reschedule pickup or switch to Courier Delivery below.";
    } else if (state.fulfillment_type === "courier") {
      statusCard.hidden = false;
      statusTitle.textContent = "Courier Delivery";
      statusText.textContent = "Thank you for your purchase! Please wait for our customer service team to contact you to arrange delivery.";
    } else {
      statusCard.hidden = true;
    }
  }

  card.hidden = !productionReady;
  if (!productionReady) {
    $("fulfillmentCurrent").textContent = "Not available yet";
    $("fulfillmentRequirement").textContent = state.handed_over_at
      ? "This order has already been handed over."
      : "Fulfillment options will appear after all production stages are finished.";
    $("fulfillmentOptions").hidden = true;
    $("fulfillmentEventPicker").hidden = true;
    $("saveFulfillmentButton").hidden = true;
    $("fulfillmentNotice").textContent = "";
    return;
  }

  $("saveFulfillmentButton").hidden = false;
  $("fulfillmentCurrent").textContent = state.fulfillment_type ? fulfillmentLabel(state.fulfillment_type) : "Not selected yet";
  $("fulfillmentRequirement").textContent = readyForSelection
    ? "Your order is ready for fulfillment selection."
    : "Production is complete. Fulfillment options will unlock after payment is fully confirmed.";

  const options = $("fulfillmentOptions");
  const notice = $("fulfillmentNotice");
  const eventPicker = $("fulfillmentEventPicker");
  if (!readyForSelection) {
    options.hidden = true;
    eventPicker.hidden = true;
    notice.textContent = "";
    return;
  }

  options.hidden = false;
  const selected = state.fulfillment_type || "";
  document.querySelectorAll("input[name='fulfillmentType']").forEach(r => r.checked = r.value === selected);
  eventPicker.hidden = selected !== "location";
  const select = $("fulfillmentEventSelect");
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose an event";
  select.appendChild(placeholder);
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


function renderCustomerReschedule() {
  const box = $("customerRescheduleBox");
  const select = $("customerRescheduleEventSelect");
  if (!box || !select) return;
  const state = fulfillmentState || {};
  const eligible = state.pickup_status === "unclaimed" && state.fulfillment_type === "location" && !state.handed_over_at;
  box.hidden = !eligible;
  if (!eligible) return;

  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a new event";
  select.appendChild(placeholder);
  const events = (state.events || []).filter(event => event.id && event.id !== state.event?.id);
  events.forEach(event => {
    const option = document.createElement("option");
    option.value = event.id;
    option.textContent = `${event.name} · ${formatEventDate(event.event_date)}${event.start_time ? ` · ${formatEventTime(event.start_time, event.end_time)}` : ""}`;
    select.appendChild(option);
  });
  if (!events.length) {
    select.disabled = true;
    $("customerRescheduleButton").disabled = true;
    $("customerRescheduleMessage").textContent = "There are no other upcoming pickup events available right now.";
  } else {
    select.disabled = false;
    $("customerRescheduleButton").disabled = false;
    $("customerRescheduleMessage").textContent = "";
  }
}

async function rescheduleCustomerPickup() {
  if (customerRescheduleBusy) return;
  const token = getTrackingToken();
  const eventId = $("customerRescheduleEventSelect")?.value || "";
  if (!token) return;
  if (!eventId) { $("customerRescheduleMessage").textContent = "Choose a new pickup event."; return; }
  customerRescheduleBusy = true;
  const button = $("customerRescheduleButton");
  if (button) { button.disabled = true; button.textContent = "Rescheduling…"; }
  $("customerRescheduleMessage").textContent = "Updating your pickup schedule…";
  try {
    const { error } = await supabase.rpc("reschedule_customer_pickup", {
      p_public_token: token,
      p_new_event_id: eventId
    });
    if (error) throw error;
    $("customerRescheduleMessage").textContent = "Pickup rescheduled successfully.";
    await loadCustomerTracking(token);
    await loadCustomerFulfillment(token);
  } catch (error) {
    console.error("Customer pickup reschedule failed:", error);
    $("customerRescheduleMessage").textContent = error?.message || "Unable to reschedule pickup.";
  } finally {
    customerRescheduleBusy = false;
    if (button) { button.disabled = false; button.textContent = "Reschedule Pickup"; }
  }
}

async function loadCustomerPaymentProof(publicToken) {
  try {
    const { data, error } = await supabase.rpc("get_customer_payment_proof", { p_public_token: publicToken });
    if (error) throw error;
    paymentProofState = data || null;
    renderPaymentProof();
  } catch (error) {
    console.error("Customer payment proof load failed:", error);
    paymentProofState = null;
    renderPaymentProof();
  }
}

function renderPaymentProof() {
  const box = $("paymentProofBox");
  if (!box) return;
  const state = paymentProofState || {};
  const remaining = Number(state.remaining ?? trackingPayload?.payment?.remaining);
  const eligible = Boolean(state.eligible) || (Number.isFinite(remaining) && remaining > 0);
  box.hidden = !eligible;
  const hint = $("paymentProofHint");
  const message = $("paymentProofMessage");
  const submit = $("submitPaymentProofButton");
  const choose = $("choosePaymentProofButton");
  const amountInput = $("paymentProofAmount");
  updatePaymentProofUploadButton();
  if (!eligible) return;
  if (state.pending_verification) {
    if (hint) hint.textContent = "Your payment proof is waiting for the seller to verify.";
  } else if (state.rejected) {
    if (hint) hint.textContent = state.rejection_reason ? `Your previous proof was rejected: ${state.rejection_reason}` : "Your previous payment proof was rejected. Please submit a new proof.";
  } else if (hint) {
    hint.textContent = `Remaining balance: ${formatWholePrice(remaining)}. Upload one proof photo for a partial or full payment.`;
  }
  if (amountInput && !amountInput.value && Number.isFinite(remaining)) amountInput.max = remaining.toFixed(2);
  if (amountInput && !amountInput.value && Number.isFinite(remaining)) amountInput.placeholder = String(Math.round(remaining));
  if (submit) submit.hidden = state.pending_verification || !state.selected_name;
  if (state.selected_name && message && !paymentProofBusy) message.textContent = `Selected: ${state.selected_name}`;
}

function updatePaymentProofUploadButton() {
  const amountInput = $("paymentProofAmount");
  const choose = $("choosePaymentProofButton");
  if (!amountInput || !choose) return;
  const state = paymentProofState || {};
  const remaining = Number(state.remaining ?? trackingPayload?.payment?.remaining);
  const amount = Number(amountInput.value);
  const validAmount = Number.isFinite(remaining) && remaining > 0
    && Number.isFinite(amount) && amount > 0 && amount <= remaining;
  choose.disabled = Boolean(state.pending_verification) || !validAmount;
}

async function submitCustomerPaymentProof() {
  if (paymentProofBusy) return;
  const token = getTrackingToken();
  const input = $("paymentProofFile");
  const file = input?.files?.[0];
  const state = paymentProofState || {};
  if (!token || !file) { $("paymentProofMessage").textContent = "Choose a proof photo first."; return; }
  const remaining = Number(state.remaining ?? trackingPayload?.payment?.remaining);
  const amount = Number($("paymentProofAmount")?.value);
  if (!state.eligible && !(Number.isFinite(remaining) && remaining > 0)) {
    $("paymentProofMessage").textContent = "Payment proof is not available for this order yet.";
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) {
    $("paymentProofMessage").textContent = `Enter an amount between 0.01 and ${formatWholePrice(remaining)}.`;
    return;
  }
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { $("paymentProofMessage").textContent = "Please choose a JPG, PNG, or WebP image."; return; }
  if (file.size > 8 * 1024 * 1024) { $("paymentProofMessage").textContent = "Please choose an image smaller than 8 MB."; return; }
  paymentProofBusy = true;
  const button = $("submitPaymentProofButton");
  if (button) { button.disabled = true; button.textContent = "Submitting…"; }
  $("paymentProofMessage").textContent = "Uploading your payment proof…";
  try {
    const form = new FormData();
    form.set("token", token);
    form.set("amount", String(amount));
    form.set("file", file, file.name || "payment-proof");
    const response = await fetch("/api/customer-payment-proof", { method: "POST", body: form });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
      throw new Error(result?.error || "Unable to submit payment proof.");
    }
    input.value = "";
    if ($("paymentProofAmount")) $("paymentProofAmount").value = "";
    clearPaymentProofPreview();
    $("paymentProofMessage").textContent = "Payment proof submitted. The seller will verify it.";
    await loadCustomerTracking(token);
    await loadCustomerPaymentProof(token);
  } catch (error) {
    console.error("Customer payment proof submit failed:", error);
    $("paymentProofMessage").textContent = error?.message || "Unable to submit payment proof.";
  } finally {
    paymentProofBusy = false;
    if (button) { button.disabled = false; button.textContent = "Submit Payment Proof"; }
  }
}

function clearPaymentProofPreview() {
  const preview = $("paymentProofPreview");
  const image = $("paymentProofPreviewImage");
  if (paymentProofPreviewUrl) URL.revokeObjectURL(paymentProofPreviewUrl);
  paymentProofPreviewUrl = null;
  if (image) image.removeAttribute("src");
  if (preview) preview.hidden = true;
}

function showPaymentProofPreview(file) {
  const preview = $("paymentProofPreview");
  const image = $("paymentProofPreviewImage");
  if (!preview || !image) return;
  if (paymentProofPreviewUrl) URL.revokeObjectURL(paymentProofPreviewUrl);
  paymentProofPreviewUrl = URL.createObjectURL(file);
  image.src = paymentProofPreviewUrl;
  preview.hidden = false;
}


async function loadCustomerPostPurchaseActions(publicToken) {
  try {
    const { data, error } = await supabase.rpc("get_customer_post_purchase_actions", { p_public_token: publicToken });
    if (error) throw error;
    customerReviewState = data?.review || null;
    customerCancellationState = data?.cancellation || null;
    renderCustomerReview();
    renderCustomerCancellation();
  } catch (error) {
    console.error("Customer post-purchase actions load failed:", error);
    customerReviewState = null;
    customerCancellationState = null;
    renderCustomerReview();
    renderCustomerCancellation();
  }
}

function renderCustomerReview() {
  const box = $("customerReviewBox");
  if (!box) return;
  const state = customerReviewState || {};
  box.hidden = !state.available;
  const hint = $("customerReviewHint");
  const button = $("submitCustomerReviewButton");
  if (!state.available) return;
  if (state.submitted) {
    if (hint) hint.textContent = "Thank you. Your review has been submitted.";
    if (button) button.hidden = true;
    document.querySelectorAll("#customerReviewStars button").forEach(b => b.disabled = true);
    $("customerReviewText").disabled = true;
    selectedReviewRating = Number(state.rating || 0);
    setReviewStars(selectedReviewRating);
    if (state.review_text) $("customerReviewText").value = state.review_text;
    return;
  }
  if (hint) hint.textContent = state.reason || "Share your experience with the seller.";
  if (button) button.hidden = false;
}

function setReviewStars(rating) {
  document.querySelectorAll("#customerReviewStars button").forEach(button => {
    button.classList.toggle("is-selected", Number(button.dataset.rating) <= Number(rating));
  });
}

async function submitCustomerReview() {
  if (customerReviewBusy) return;
  const token = getTrackingToken();
  if (!token) return;
  const rating = Number(selectedReviewRating);
  if (!rating || rating < 1 || rating > 5) {
    $("customerReviewMessage").textContent = "Choose a rating from 1 to 5 stars.";
    return;
  }
  customerReviewBusy = true;
  const button = $("submitCustomerReviewButton");
  button.disabled = true;
  $("customerReviewMessage").textContent = "Submitting your review…";
  try {
    const { error } = await supabase.rpc("submit_customer_review", {
      p_public_token: token,
      p_rating: rating,
      p_review_text: $("customerReviewText").value.trim() || null
    });
    if (error) throw error;
    await loadCustomerPostPurchaseActions(token);
    $("customerReviewMessage").textContent = "Thank you for your review.";
  } catch (error) {
    console.error("Customer review submit failed:", error);
    $("customerReviewMessage").textContent = error?.message || "Unable to submit your review.";
  } finally {
    customerReviewBusy = false;
    button.disabled = false;
  }
}

function renderCustomerCancellation() {
  const box = $("customerCancellationBox");
  if (!box) return;
  const state = customerCancellationState || {};
  box.hidden = !state.available;
  if (!state.available) return;
  $("customerCancellationHint").textContent = state.hint || "This item is still eligible for cancellation.";
  if (state.cancelled) {
    box.hidden = false;
    $("customerCancelItemButton").hidden = true;
    $("customerCancellationHint").textContent = "This item has been cancelled.";
  }
}

async function cancelCustomerItem() {
  if (customerCancellationBusy) return;
  const token = getTrackingToken();
  if (!token) return;
  const confirmed = window.confirm("Cancel this product from the order? This cannot be undone.");
  if (!confirmed) return;
  customerCancellationBusy = true;
  const button = $("customerCancelItemButton");
  button.disabled = true;
  $("customerCancellationMessage").textContent = "Cancelling…";
  try {
    const { error } = await supabase.rpc("cancel_customer_order_item", {
      p_public_token: token,
      p_reason: "Customer cancelled from tracking page"
    });
    if (error) throw error;
    await loadCustomerTracking(token);
    await loadCustomerPostPurchaseActions(token);
    $("customerCancellationMessage").textContent = "This item has been cancelled.";
  } catch (error) {
    console.error("Customer item cancellation failed:", error);
    $("customerCancellationMessage").textContent = error?.message || "Unable to cancel this item.";
  } finally {
    customerCancellationBusy = false;
    button.disabled = false;
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
  const orderItems = Array.isArray(payload?.order_items) ? payload.order_items : [];
  const multipleItems = orderItems.length > 1;

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
  renderTrackingOrderItems(orderItems);
  $("trackingViewOrderButton").hidden = !multipleItems;
  $("trackingOrderCard").hidden = !multipleItems || !trackingOrderVisible;
  $("trackingViewOrderButton").textContent = trackingOrderVisible ? "Hide My Order" : "View My Order";
  moveWholeOrderCards(orderItems.length || 1);
}

async function loadCustomerTracking(publicToken) {
  trackingPayload = null;
  trackingOrderVisible = false;
  paymentProofState = null;
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
    await loadCustomerPaymentProof(publicToken);
    await loadCustomerPostPurchaseActions(publicToken);
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
document.querySelectorAll("#customerReviewStars button").forEach(button => {
  button.addEventListener("click", () => {
    selectedReviewRating = Number(button.dataset.rating);
    setReviewStars(selectedReviewRating);
  });
});
$("submitCustomerReviewButton")?.addEventListener("click", submitCustomerReview);
$("customerCancelItemButton")?.addEventListener("click", cancelCustomerItem);
$("customerRescheduleButton")?.addEventListener("click", rescheduleCustomerPickup);

$("fulfillmentEventSelect")?.addEventListener("change", () => {
  const option = $("fulfillmentEventSelect").selectedOptions[0];
  const location = option?.dataset.location || "";
  if (location) $("fulfillmentNotice").textContent = location;
});

$("choosePaymentProofButton")?.addEventListener("click", () => $("paymentProofFile")?.click());
$("paymentProofFile")?.addEventListener("change", () => {
  const file = $("paymentProofFile").files?.[0];
  if (file) {
    paymentProofState = { ...(paymentProofState || {}), selected_name: file.name };
    showPaymentProofPreview(file);
    renderPaymentProof();
  } else {
    paymentProofState = { ...(paymentProofState || {}), selected_name: null };
    renderPaymentProof();
  }
});
$("paymentProofAmount")?.addEventListener("input", () => {
  updatePaymentProofUploadButton();
  renderPaymentProof();
});
$("paymentProofAmount")?.addEventListener("change", updatePaymentProofUploadButton);
$("removePaymentProofButton")?.addEventListener("click", () => {
  const input = $("paymentProofFile");
  if (input) input.value = "";
  paymentProofState = { ...(paymentProofState || {}), selected_name: null };
  clearPaymentProofPreview();
  renderPaymentProof();
});
$("submitPaymentProofButton")?.addEventListener("click", submitCustomerPaymentProof);
$("customerPhotoViewerClose")?.addEventListener("click", () => {
  const viewer = $("customerPhotoViewer");
  if (viewer?.open && viewer.close) viewer.close();
  else if (viewer) viewer.hidden = true;
});
$("customerPhotoViewer")?.addEventListener("click", (event) => {
  if (event.target === $("customerPhotoViewer")) event.target.close?.();
});
