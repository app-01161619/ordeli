Ordeli product duplicate display fix

Cause:
The app could run renderApplication() more than once at the same time during startup/reload (for example the initial render and the Supabase auth-state callback). Each concurrent render could load the same product rows and append them, causing one database row to appear multiple times.

Fix:
- Added a single-flight render lock.
- Product list is cleared/rebuilt from one database result.
- Stale product loads are ignored if the route changes.

Replace only:
- index.html
- js/app.js
- css/style.css

Keep your working js/supabase.js and all PWA files unchanged.
No SQL changes are required.
