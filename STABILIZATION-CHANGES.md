# Ordeli stabilization pass — 2026-09-09

## Applied in this revision

- Added seller `apple-touch-icon` declaration.
- Removed duplicate Home Quick Actions for Products and QR Management; their listeners were removed too.
- Added a small shared CSS token palette for the core UI.
- Consolidated `.event-card` into one authoritative base rule and added a narrow-screen one-column layout.
- Standardized the main responsive cutoffs used by the dashboard/event/team/production areas toward 640px / 900px.
- Repaired the seller Reviews route so the existing Reviews screen and loader are reachable.
- Removed duplicated Team / Production event listeners.
- Moved service-worker registration into `js/register-sw.js` so the seller page no longer needs an inline script.
- Updated the seller app/service-worker cache version to 2026-09-09-01.
- Added `cdn.jsdelivr.net` to the service-worker CDN cache host list.
- Pinned Supabase JS to `@supabase/supabase-js@2.115.0` in both seller and customer applications.
- Added Cloudflare Pages `_headers` with baseline security headers and a CSP compatible with the current external SDK/QR dependencies.
- Event editor change-reason behavior now applies only to existing events whose schedule is actually changed; creating a new event does not require a reason.
- Reschedule Event now requires a reason before the move is submitted.

## Intentionally not changed from the ZIP-only pass

These require verification or database-side changes rather than guessing:

- Supabase Row Level Security policies.
- Supabase Storage policies for payment proofs and production photos.
- Authorization rules inside all RPCs.
- Transactional event reschedule/update RPC behavior.
- Offline production idempotency on the server.
- Replacement customer QR generation flow.
- Password recovery implementation.

Those items remain on the production-readiness checklist until the live Supabase security boundary is verified.


## Post-deploy regression fixes (2026-09-09)
- Fixed the Reviews screen registration in the `screens` map so `showScreen("reviews")` can reveal it.
- Fixed shop onboarding completion: saving the shop profile now navigates to `#home` before re-rendering the application.
- Worker now attaches the authoritative CSP/security headers to asset responses, including `cdn.jsdelivr.net` in `connect-src`.
- Bumped service-worker cache namespaces again to force replacement of the earlier cached app shell.
