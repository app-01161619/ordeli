import { getSession } from './auth.js';
import { getMyShop } from './shop.js';

import * as SignInPage from './pages/sign-in.js';
import * as OnboardingPage from './pages/onboarding.js';
import * as HomePage from './pages/home.js';
import * as OrdersPage from './pages/orders.js';
import * as ScanPage from './pages/scan.js';
import * as EventsPage from './pages/events.js';
import * as MorePage from './pages/more.js';

const PAGES = {
  'sign-in': SignInPage,
  onboarding: OnboardingPage,
  home: HomePage,
  orders: OrdersPage,
  scan: ScanPage,
  events: EventsPage,
  more: MorePage,
};

export const TABS = [
  { route: 'home', label: 'Home', icon: iconHome() },
  { route: 'orders', label: 'Orders', icon: iconOrders() },
  { route: 'scan', label: 'Scan', icon: iconScan() },
  { route: 'events', label: 'Events', icon: iconEvents() },
  { route: 'more', label: 'More', icon: iconMore() },
];

const TAB_ROUTES = new Set(TABS.map((t) => t.route));

function currentRoute() {
  return (window.location.hash || '#/sign-in').replace(/^#\//, '');
}

/**
 * Runs on every hashchange (and once at startup). Decides the *actual*
 * route to render after applying the auth guard, renders it into
 * `pageContainer`, and reports back whether the tab bar should be visible
 * (only once signed in AND onboarded) via `onTabBarVisibility`.
 */
export async function initRouter({ pageContainer, onTabBarVisibility, onActiveTab }) {
  async function resolveAndRender() {
    const requested = currentRoute();
    const session = getSession();

    if (!session) {
      onTabBarVisibility(false);
      await renderRoute('sign-in', pageContainer);
      if (requested !== 'sign-in') {
        window.location.hash = '#/sign-in';
      }
      return;
    }

    const { shop } = await getMyShop(session);

    if (!shop) {
      onTabBarVisibility(false);
      await renderRoute('onboarding', pageContainer);
      if (requested !== 'onboarding') {
        window.location.hash = '#/onboarding';
      }
      return;
    }

    // Signed in and onboarded — don't let them sit on sign-in/onboarding.
    const target = TAB_ROUTES.has(requested) ? requested : 'home';
    onTabBarVisibility(true);
    onActiveTab(target);
    await renderRoute(target, pageContainer);
    if (requested !== target) {
      window.location.hash = `#/${target}`;
    }
  }

  window.addEventListener('hashchange', resolveAndRender);
  await resolveAndRender();

  // Auth state can change without a hashchange event (sign-in, sign-out) —
  // callers should re-invoke this after those, see app.js.
  return resolveAndRender;
}

let currentPage = null;

async function renderRoute(route, pageContainer) {
  currentPage?.onLeave?.();

  const page = PAGES[route];
  currentPage = page ?? null;

  if (!page) {
    pageContainer.innerHTML = '<div class="screen"><p>Not found.</p></div>';
    return;
  }
  await page.render(pageContainer);
}

function iconHome() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>';
}
function iconOrders() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h9l3 3v17H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>';
}
function iconScan() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M4 12h16"/></svg>';
}
function iconEvents() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
}
function iconMore() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';
}
