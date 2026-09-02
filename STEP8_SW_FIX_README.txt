Step 8 customer tracking service-worker fix

Replace ONLY:
- index.html
- sw.js

Commit/push those two files to GitHub.

The customer /t/<token> page no longer registers the seller service worker.
Any old service worker scoped to /t/ is unregistered, then the customer page reloads once.
Seller pages at / continue using /sw.js normally.
