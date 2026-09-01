Ordeli Step 7 fix

Fixes the recurring ReferenceError: currentOrderTotal is not defined.

The currentOrderTotal/currentOrderPaid variables are explicitly initialized and reset before Order Details loads. The Order Details route also keeps loading errors on that screen instead of falling through to the login screen.

Payment type is still automatic; seller enters only the payment amount.

Replace: index.html, js/app.js, css/style.css
Keep: js/supabase.js, sw.js, manifest.webmanifest, current Cloudflare files
No SQL changes.
