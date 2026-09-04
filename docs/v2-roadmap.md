# Ordeli v2 implementation roadmap

## Phase A — foundation (current)
- Keep existing Supabase schema aligned with real exported structure.
- Eliminate `selected_event_id` assumptions.
- Strengthen indexes and integrity checks.
- Preserve event assignment in `orders.event_id`.

## Phase B — seller operations
- Rework Home into a task-oriented dashboard.
- Add Orders list with production/payment/fulfillment filters.
- Add event calendar and event detail.
- Add Bring to Event quantities and order preparation.
- Add whole-order handover.
- Add unclaimed/reschedule flows.
- Add seller-side payment-proof verification.
- Add seller-only SMS update drafts/actions.
- Add production-member management and permission-aware actions.

## Phase C — offline-first completion
- Generalize the IndexedDB mutation queue beyond order creation.
- Add durable retry/backoff and visible sync errors.
- Add mutation idempotency for stage logs, payments, event assignment,
  handover, and cancellations.
- Keep locally committed state immediately visible.
- Reconcile server confirmations without blocking the UI.

## Phase D — customer experience
- Fulfillment selection only after production + confirmed payment.
- Pickup-at-shop address.
- Pickup-at-location eligible events.
- Rescheduling and unclaimed states.
- Customer payment-proof upload + seller verification result.
- Courier handoff message without collecting shipping details.
- Final order review flow.

## Phase E — polish
- Mobile-first visual redesign.
- Better empty/loading/error states.
- Accessible scanner/feedback states.
- Print-card improvements.
- Performance and cache tuning.
