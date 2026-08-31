Ordeli Step 7 scan fix

The assigned QR was opening Order Details, but the payment UI referenced
currentOrderTotal before that variable existed in the current app.js.

This fix:
- initializes currentOrderTotal and currentOrderPaid
- resets them before loading an order
- keeps order-detail errors on the Order Details screen instead of falling
  back to the login screen

Replace:
  index.html
  js/app.js
  css/style.css

Keep:
  js/supabase.js
  sw.js
  manifest.webmanifest
  _headers only if your current working Cloudflare deployment uses it

No SQL changes are required.
