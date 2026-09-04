# Ordeli — v2 Architecture Direction

## Product target

Ordeli is a seller-first, offline-first custom-order operations app. The seller application is the operational system of record; the customer site is a deliberately smaller, server-backed tracking and fulfillment surface.

## Design decisions

### 1. Seller app is task-first

The main screen should answer "what needs my attention?" before showing analytics. The primary action is QR scanning because scanning is the shortest route into order creation, order lookup, production, and handover.

Recommended primary navigation:

- Home
- Orders
- Scan
- Events
- More

More contains Products, QR Management, Production Team, Shop Profile, and Settings.

### 2. Order state is multidimensional

Do not serialize every combination into one status string. Compute and present independent dimensions:

- Production: pending / in-progress / completed
- Payment: unpaid / partially paid / pending verification / rejected / fully paid
- Fulfillment: not selected / shop pickup / event pickup / courier
- Pickup: not scheduled / scheduled / bring to event / unclaimed / rescheduled / handed over
- Overall: active / fulfilled / cancelled

This keeps the UI understandable and prevents contradictory states.

### 3. QR is the operational key

A QR represents one order item. Quantity is independent. A multi-item order therefore has multiple product-specific QRs, but a seller can resolve the whole parent order from any one item QR.

### 4. Production is history, not a mutable status machine

A workflow is copied to the order item at creation. Stage completion is recorded as events in `stage_logs`. Sending back means adding a compensating `sent_back` event; it does not erase history.

The UI derives the next available stage from the event history. The final workflow stage causes item completion automatically.

### 5. Offline means local-first

Every normal seller write should follow:

1. Validate input locally.
2. Commit the local state immediately.
3. Put a durable operation in IndexedDB.
4. Reflect `Waiting to Sync` in the interface.
5. Replay the operation online using an idempotency key.
6. Mark it `Synchronized` only after the server confirms it.
7. Keep failed operations visible and retryable.

Photos use the same pattern: store a local blob reference/queued upload record first, upload when online, then attach the resulting path to the immutable production event.

### 6. Customer access is token-based

Customers do not authenticate. A QR/public token resolves to an order item through a security-definer RPC that returns only customer-safe fields. Internal IDs, employee identities, private notes, and payment-proof files are never returned.

### 7. Sensitive files stay private

Payment proofs must never be public. Production proof photos should also be private in storage and delivered with short-lived signed URLs when displayed to an authorized customer.

## Development order

1. Database foundation and security
2. Seller shell/navigation/dashboard
3. Order list and detail as the operational hub
4. Payment verification and payment actions
5. Events / Bring to Event / handover / unclaimed / rescheduling
6. Production team
7. Offline mutation engine generalized beyond order creation
8. Customer fulfillment / payment-proof / review flows
9. Polish, accessibility, empty/error/loading states, and install/update UX

## What is deliberately flexible

The visual language, component hierarchy, exact route names, labels, and microinteractions are not sacred. They can be redesigned when testing reveals a faster or clearer workflow. The business invariants in the original requirements remain the source of truth.
