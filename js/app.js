import { initAuth, onAuthChange } from './auth.js';
import { initRouter, TABS } from './router.js';

async function main() {
  const app = document.getElementById('app');

  const pageContainer = document.createElement('div');
  pageContainer.id = 'page-container';
  pageContainer.style.flex = '1';
  pageContainer.style.display = 'flex';
  pageContainer.style.flexDirection = 'column';

  const tabBar = document.createElement('nav');
  tabBar.className = 'tab-bar';
  tabBar.hidden = true;
  tabBar.innerHTML = TABS.map(
    (tab) => `
      <button type="button" class="tab-bar-item" data-route="${tab.route}">
        ${tab.icon}
        <span>${tab.label}</span>
      </button>
    `
  ).join('');

  app.appendChild(pageContainer);
  app.appendChild(tabBar);

  tabBar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-route]');
    if (button) {
      window.location.hash = `#/${button.dataset.route}`;
    }
  });

  function setTabBarVisibility(visible) {
    tabBar.hidden = !visible;
  }

  function setActiveTab(route) {
    for (const button of tabBar.querySelectorAll('[data-route]')) {
      button.classList.toggle('active', button.dataset.route === route);
    }
  }

  await initAuth();

  const rerender = await initRouter({
    pageContainer,
    onTabBarVisibility: setTabBarVisibility,
    onActiveTab: setActiveTab,
  });

  // Sign-in / sign-out change the session without necessarily firing
  // hashchange, so re-run the router's resolve-and-render whenever auth
  // state changes.
  onAuthChange(() => {
    rerender();
  });
}

main();

registerServiceWorker();

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;

        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast(() => {
              installing.postMessage({ type: 'SKIP_WAITING' });
            });
          }
        });
      });
    } catch (err) {
      console.warn('Service worker registration failed:', err);
    }
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

function showUpdateToast(onUpdate) {
  const toast = document.createElement('div');
  toast.className = 'update-toast';
  toast.innerHTML = `
    <span>A new version is available.</span>
    <button type="button">Refresh</button>
  `;
  toast.querySelector('button').addEventListener('click', () => {
    onUpdate();
    toast.remove();
  });
  document.body.appendChild(toast);
}
