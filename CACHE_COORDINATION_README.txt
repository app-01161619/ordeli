The uploaded ZIP actually contains currentOrderTotal/currentOrderPaid declarations. The reported browser error therefore indicates an OLD app.js is still being executed, not that the uploaded source lacks the variables. This package coordinates cache invalidation without changing the application logic.

Replace only index.html and sw.js (you can leave app.js/css as they are). The index now uses a versioned app.js URL and the service worker version is bumped.

After deploying, fully close the installed PWA/browser tab and reopen once. No SQL changes.
