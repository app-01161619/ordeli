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

    // Only render the button when Supabase confirms that a proof photo exists.
    if (stage.status === "finished" && stage.has_photo === true) {
      const proofButton = document.createElement("button");
      proofButton.type = "button";
      proofButton.className = "tracking-photo-button";
      proofButton.textContent = "View Photo";
      proofButton.setAttribute("aria-label", `View ${name.textContent} production proof photo`);
      proofButton.addEventListener("click", () => viewCustomerProductionProof(stage.stage_order, proofButton));
      body.appendChild(proofButton);
    }

    row.append(icon, body);
    fragment.appendChild(row);
  });
  list.appendChild(fragment);
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
    const endpoint = `/api/customer-stage-proof?token=${encodeURIComponent(token)}&stage_order=${encodeURIComponent(Number(stageOrder))}`;
    let data = null;
    let response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store"
    }).catch(() => null);

    if (response?.ok) data = await response.json().catch(() => null);

    // Direct hardened RPC fallback keeps the production-proof bucket private
    // when the Worker is unavailable or not configured.
    if (!data?.available || !data?.url) {
      const { data: fallback, error } = await supabase.rpc("get_customer_stage_proof", {
        p_public_token: token,
        p_stage_order: Number(stageOrder)
      });
      if (error) throw error;
      data = fallback;
    }

    if (!data?.available || !data?.url) {
      throw new Error("No proof photo is available for this stage.");
    }

    const viewer = $("customerPhotoViewer");
    const image = $("customerPhotoViewerImage");
    const caption = $("customerPhotoViewerCaption");
    if (!viewer || !image) throw new Error("Photo viewer is unavailable.");
    image.src = data.url;
    image.onload = () => image.classList.add("is-loaded");
    image.onerror = () => image.classList.remove("is-loaded");
    if (caption) caption.textContent = `${data.stage_name || `Stage ${stageOrder}`} · Production proof`;
    if (typeof viewer.showModal === "function") viewer.showModal();
    else viewer.removeAttribute("hidden");
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

function renderFulfillment() {
  const card = $("trackingFulfillmentCard");
  if (!card) return;
  const state = fulfillmentState || {};
  renderCustomerReschedule();

  // The Fulfillment card does not appear until every production stage is complete.
  const productionComplete = Boolean(state.production_completed);
  card.hidden = !productionComplete;
  if (!productionComplete) return;

  const fullyPaid = Boolean(state.fully_paid);
  const ready = Boolean(fullyPaid && !state.handed_over_at);
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

  $("fulfillmentCurrent").textContent = state.fulfillment_type ? fulfillmentLabel(state.fulfillment_type) : "Not selected yet";

  const shopAddressBox = $("fulfillmentShopAddress");
  const shopAddress = trackingPayload?.shop?.address || "";
  if (shopAddressBox) {
    const showAddress = state.fulfillment_type === "shop" && Boolean(shopAddress);
    shopAddressBox.hidden = !showAddress;
    if (showAddress) $("fulfillmentShopAddressText").textContent = shopAddress;
  }

  $("fulfillmentRequirement").textContent = ready
    ? "Your order is ready for fulfillment selection."
    : state.handed_over_at
      ? "This order has already been handed over."
      : "Production is complete. Fulfillment options will unlock after payment is fully confirmed.";

  const options = $("fulfillmentOptions");
  const notice = $("fulfillmentNotice");
  const eventPicker = $("fulfillmentEventPicker");
  const saveButton = $("saveFulfillmentButton");
  if (!ready) {
    options.hidden = true;
    eventPicker.hidden = true;
    if (saveButton) saveButton.hidden = true;
    notice.textContent = "";
    return;
  }

  if (saveButton) saveButton.hidden = false;
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
    notice.textContent = "Thank you for your purchase! Please wait for our customer service team to contact you to arrange delivery.";
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

function revokePaymentPreview() {
  const preview = $("paymentProofPreview");
  if (preview?.dataset.objectUrl) {
    URL.revokeObjectURL(preview.dataset.objectUrl);
    delete preview.dataset.objectUrl;
  }
  if (preview) preview.removeAttribute("src");
  $("paymentProofPreviewWrap")?.setAttribute("hidden", "");
}

function renderPaymentProof() {
  const addButton = $("addPaymentButton");
  const box = $("paymentProofBox");
  if (!addButton || !box) return;

  const state = paymentProofState || {};
  const payloadRemaining = Number(trackingPayload?.payment?.remaining);
  const remaining = Number.isFinite(Number(state.remaining)) ? Number(state.remaining) : payloadRemaining;
  const eligible = Boolean((state.eligible ?? Number.isFinite(payloadRemaining)) && remaining > 0);
  const pendingVerification = Boolean(state.pending_verification);
  const canAddPayment = eligible && !pendingVerification;
  if (Number.isFinite(remaining)) state.remaining = remaining;
  // Never show a tappable Add Payment action when a proof is already pending.
  // The previous implementation left the button visible but openAddPaymentForm()
  // immediately returned, making the tap appear to do nothing.
  addButton.hidden = !canAddPayment;
  addButton.disabled = !canAddPayment;

  const hint = $("paymentProofHint");
  const message = $("paymentProofMessage");
  const submit = $("submitPaymentProofButton");
  const choose = $("choosePaymentProofButton");
  const amountHint = $("paymentAmountHint");
  const amountInput = $("paymentAmountInput");

  if (!canAddPayment) {
    box.hidden = true;
    revokePaymentPreview();
    if (message) message.textContent = pendingVerification
      ? "Your payment proof is waiting for the seller to verify it."
      : "";
    if (amountInput) amountInput.value = "";
    return;
  }

  if (pendingVerification) {
    if (hint) hint.textContent = "Your payment proof is waiting for the seller to verify it.";
    if (submit) submit.hidden = true;
    if (choose) choose.disabled = true;
    if (amountInput) amountInput.disabled = true;
    if (amountHint) amountHint.textContent = "A payment is already pending seller verification.";
    return;
  }

  if (state.rejected) {
    if (hint) hint.textContent = state.rejection_reason
      ? `Your previous proof was rejected: ${state.rejection_reason}`
      : "Your previous payment proof was rejected. Please submit a new proof.";
  } else if (hint) {
    hint.textContent = `You can pay any amount up to ${formatPrice(state.remaining)}. Both the proof photo and amount are required.`;
  }
  if (submit) submit.hidden = false;
  if (choose) choose.disabled = false;
  if (amountInput) amountInput.disabled = false;
  if (amountHint) amountHint.textContent = `Maximum for this payment: ${formatPrice(state.remaining)}`;
  if (state.selected_name && message && !paymentProofBusy) message.textContent = `Selected: ${state.selected_name}`;
}

function openAddPaymentForm() {
  const box = $("paymentProofBox");
  if (!box) return;
  const state = paymentProofState || {};
  const payloadRemaining = Number(trackingPayload?.payment?.remaining);
  const remaining = Number.isFinite(Number(state.remaining)) ? Number(state.remaining) : payloadRemaining;
  const eligible = Number.isFinite(remaining) && remaining > 0;
  if (!eligible || state.pending_verification) {
    const message = $("paymentProofMessage");
    if (message) message.textContent = state.pending_verification
      ? "Your payment proof is waiting for the seller to verify it."
      : "There is no remaining balance available for payment.";
    return;
  }
  paymentProofState = { ...state, eligible: true, remaining };
  box.hidden = false;
  box.removeAttribute("hidden");
  renderPaymentProof();
  $("paymentAmountInput")?.focus();
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function handlePaymentProofSelection() {
  const input = $("paymentProofFile");
  const file = input?.files?.[0];
  const previewWrap = $("paymentProofPreviewWrap");
  const preview = $("paymentProofPreview");
  const message = $("paymentProofMessage");
  if (!file || !previewWrap || !preview) return;

  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    input.value = "";
    revokePaymentPreview();
    if (message) message.textContent = "Please choose a JPG, PNG, or WebP image.";
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    input.value = "";
    revokePaymentPreview();
    if (message) message.textContent = "Please choose an image smaller than 8 MB.";
    return;
  }

  revokePaymentPreview();
  const objectUrl = URL.createObjectURL(file);
  preview.src = objectUrl;
  preview.dataset.objectUrl = objectUrl;
  previewWrap.hidden = false;
  paymentProofState = { ...(paymentProofState || {}), selected_name: file.name };
  if (message) message.textContent = `Selected: ${file.name}`;
}

async function submitCustomerPaymentProof() {
  if (paymentProofBusy) return;
  const token = getTrackingToken();
  const input = $("paymentProofFile");
  const file = input?.files?.[0];
  const amountInput = $("paymentAmountInput");
  const state = paymentProofState || {};
  const amount = Number(amountInput?.value);

  if (!token) return;
  if (!state.eligible || Number(state.remaining) <= 0) {
    $("paymentProofMessage").textContent = "There is no remaining balance available for payment.";
    return;
  }
  if (state.pending_verification) {
    $("paymentProofMessage").textContent = "A payment proof is already pending seller verification.";
    return;
  }
  if (!file) {
    $("paymentProofMessage").textContent = "Upload the payment proof screenshot first.";
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    $("paymentProofMessage").textContent = "Enter the amount you paid.";
    amountInput?.focus();
    return;
  }
  const remaining = Number(state.remaining);
  if (amount > remaining + 0.000001) {
    $("paymentProofMessage").textContent = `The amount cannot exceed the remaining balance of ${formatPrice(remaining)}.`;
    amountInput?.focus();
    return;
  }
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    $("paymentProofMessage").textContent = "Please choose a JPG, PNG, or WebP image.";
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    $("paymentProofMessage").textContent = "Please choose an image smaller than 8 MB.";
    return;
  }

  paymentProofBusy = true;
  const button = $("submitPaymentProofButton");
  if (button) { button.disabled = true; button.textContent = "Submitting…"; }
  $("choosePaymentProofButton").disabled = true;
  amountInput.disabled = true;
  $("paymentProofMessage").textContent = "Uploading your payment proof…";

  try {
    const form = new FormData();
    form.set("token", token);
    form.set("amount", amount.toFixed(2));
    form.set("file", file, file.name || "payment-proof");
    const response = await fetch("/api/customer-payment-proof", { method: "POST", body: form });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
      throw new Error(result?.error || "Unable to submit payment proof.");
    }

    input.value = "";
    revokePaymentPreview();
    if (amountInput) amountInput.value = "";
    $("paymentProofMessage").textContent = `Payment proof for ${formatPrice(amount)} submitted. The seller will verify it.`;
    await loadCustomerTracking(token);
    await loadCustomerPaymentProof(token);
    // Keep the Add Payment form closed after a successful submission.
    $("paymentProofBox").hidden = true;
  } catch (error) {
    console.error("Customer payment proof submit failed:", error);
    $("paymentProofMessage").textContent = error?.message || "Unable to submit payment proof.";
  } finally {
    paymentProofBusy = false;
    const currentButton = $("submitPaymentProofButton");
    if (currentButton) { currentButton.disabled = false; currentButton.textContent = "Submit Payment"; }
    const currentState = paymentProofState || {};
    if (!currentState.pending_verification) {
      $("choosePaymentProofButton").disabled = false;
      amountInput.disabled = false;
    }
  }
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

async function switchCustomerToCourier() {
  if (fulfillmentBusy) return;
  const token = getTrackingToken();
  if (!token) return;
  const confirmed = window.confirm("Switch this order to Courier Delivery instead of pickup?");
  if (!confirmed) return;
  fulfillmentBusy = true;
  const button = $("customerSwitchToCourierButton");
  if (button) { button.disabled = true; button.textContent = "Switching…"; }
  $("customerRescheduleMessage").textContent = "Switching to Courier Delivery…";
  try {
    const { error } = await supabase.rpc("set_customer_fulfillment", { p_public_token: token, p_fulfillment_type: "courier", p_event_id: null });
    if (error) throw error;
    await loadCustomerTracking(token);
    await loadCustomerFulfillment(token);
    $("fulfillmentNotice").textContent = "Thank you for your purchase! Our customer service team will contact you to arrange delivery.";
  } catch (error) {
    console.error("Customer switch to courier failed:", error);
    $("customerRescheduleMessage").textContent = error?.message || "Unable to switch to Courier Delivery.";
  } finally {
    fulfillmentBusy = false;
    if (button) { button.disabled = false; button.textContent = "Switch to Courier Delivery"; }
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
  // Payment controls are driven by the latest server-reported remaining balance.
  paymentProofState = { ...(paymentProofState || {}), eligible: Number(payment.remaining) > 0, remaining: Number(payment.remaining) || 0 };
  renderPaymentProof();
  const orderItems = payload?.order_items || [];
  renderTrackingOrderItems(orderItems);
  const isMultiItemOrder = orderItems.length > 1;
  if (!isMultiItemOrder) trackingOrderVisible = false;
  $("trackingViewOrderButton").hidden = !isMultiItemOrder;
  $("trackingOrderCard").hidden = !isMultiItemOrder || !trackingOrderVisible;
  $("trackingViewOrderButton").textContent = trackingOrderVisible ? "Hide My Order" : "View My Order";
}

async function loadCustomerTracking(publicToken) {
  trackingPayload = null;
  trackingOrderVisible = false;
  paymentProofState = null;
  revokePaymentPreview();
  $("trackingLoadingState").hidden = false;
  $("trackingErrorState").hidden = true;
  $("trackingContent").hidden = true;
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_customer_tracking`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ p_public_token: publicToken }),
        cache: "no-store",
        signal: controller.signal
      });
    } finally {
      window.clearTimeout(timeoutId);
    }

    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
    if (!response.ok) {
      throw new Error(data?.message || data?.hint || data?.details || `Tracking request failed (${response.status}).`);
    }
    if (!data) throw new Error("Tracking information is not available.");

    trackingPayload = { ...data, _token: publicToken };
    renderCustomerTracking(trackingPayload);
    await Promise.allSettled([
      loadCustomerFulfillment(publicToken),
      loadCustomerPaymentProof(publicToken),
      loadCustomerPostPurchaseActions(publicToken)
    ]);
  } catch (error) {
    console.error("Customer tracking load failed:", error);
    showTrackingError(error?.name === "AbortError"
      ? "The tracking request timed out. Please tap Refresh and try again."
      : error?.message || "This tracking link could not be loaded.");
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
$("customerSwitchToCourierButton")?.addEventListener("click", switchCustomerToCourier);

$("fulfillmentEventSelect")?.addEventListener("change", () => {
  const option = $("fulfillmentEventSelect").selectedOptions[0];
  const location = option?.dataset.location || "";
  if (location) $("fulfillmentNotice").textContent = location;
});

$("choosePaymentProofButton")?.addEventListener("click", () => $("paymentProofFile")?.click());
$("paymentProofFile")?.addEventListener("change", handlePaymentProofSelection);
$("submitPaymentProofButton")?.addEventListener("click", submitCustomerPaymentProof);
$("addPaymentButton")?.addEventListener("click", openAddPaymentForm);
$("clearPaymentProofButton")?.addEventListener("click", () => {
  const input = $("paymentProofFile");
  if (input) input.value = "";
  revokePaymentPreview();
  paymentProofState = { ...(paymentProofState || {}), selected_name: "" };
  const message = $("paymentProofMessage");
  if (message) message.textContent = "";
});
function closeCustomerPhotoViewer() {
  const viewer = $("customerPhotoViewer");
  if (!viewer) return;
  try {
    if (typeof viewer.close === "function" && viewer.open) viewer.close();
    else viewer.removeAttribute("open");
  } catch (_) {
    viewer.removeAttribute("open");
  }
}
$("customerPhotoViewerClose")?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeCustomerPhotoViewer();
});
$("customerPhotoViewer")?.addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeCustomerPhotoViewer();
});
$("customerPhotoViewer")?.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeCustomerPhotoViewer();
});
$("customerPhotoViewer")?.addEventListener("close", () => {
  const image = $("customerPhotoViewerImage");
  if (image) { image.removeAttribute("src"); image.classList.remove("is-loaded"); }
});
