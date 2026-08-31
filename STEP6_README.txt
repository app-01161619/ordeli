Ordeli Step 6 — Customer / Order Creation

Replace:
- index.html
- js/app.js
- css/style.css

Run in Supabase:
- supabase/006_order_creation.sql

Keep:
- js/supabase.js with your real credentials
- manifest.webmanifest
- sw.js
- _headers only if it is part of your currently working Cloudflare setup

Flow:
Home -> bottom-center Scan QR

Available QR:
  -> Create Order
  -> customer name OR existing active customer
  -> optional phone
  -> quantity
  -> downpayment (can be 0)
  -> Save Order
  -> Order Details

Assigned QR:
  -> Order Details

Order Details:
  -> Add Another Item
  -> scan another available QR
  -> quantity only
  -> same customer/order

The RPC locks the QR row while assigning it so two online operations cannot
successfully claim the same available QR at the same time.

No customer-facing tracking page, payment management, production execution,
or offline synchronization is included yet.
