import { isSupabaseConfigured, supabase } from './supabase-client.js';

const COPY = {
  checking: { label: 'Checking connection…', dotClass: 'connection-dot--checking' },
  connected: { label: 'Connected to Supabase', dotClass: 'connection-dot--connected' },
  error: { label: 'Could not reach Supabase', dotClass: 'connection-dot--error' },
  'not-configured': {
    label: 'Supabase is not configured yet',
    dotClass: 'connection-dot--not-configured',
  },
};

/**
 * Same canary check as the earlier Expo build: a head-only, RLS-safe query
 * against `shops`. Reachable + table exists = connected, regardless of
 * whether anyone's signed in yet.
 */
async function checkConnection() {
  if (!isSupabaseConfigured) {
    return { state: 'not-configured', message: 'Fill in your project URL and key in js/config.js, then reload.' };
  }

  try {
    const { error } = await supabase.from('shops').select('id', { count: 'exact', head: true });
    if (error) {
      return { state: 'error', message: error.message };
    }
    return { state: 'connected', message: null };
  } catch (err) {
    return { state: 'error', message: err instanceof Error ? err.message : 'Could not reach Supabase.' };
  }
}

/**
 * Renders a connection status card into `container` and kicks off the
 * check. Returns nothing — it manages its own DOM updates.
 */
export function renderConnectionStatus(container) {
  const card = document.createElement('div');
  card.className = 'connection-card';
  container.appendChild(card);

  async function run() {
    renderState(card, { state: 'checking', message: null });
    const result = await checkConnection();
    renderState(card, result);
  }

  run();

  function renderState(card, { state, message }) {
    const copy = COPY[state];
    card.innerHTML = `
      <div class="connection-row">
        <span class="connection-dot ${copy.dotClass}"></span>
        <span class="text-small-bold">${copy.label}</span>
        ${state === 'checking' ? '<span class="spinner"></span>' : ''}
      </div>
      ${message ? `<div class="connection-message">${escapeHtml(message)}</div>` : ''}
      ${state === 'error' ? '<button class="link-button" type="button" data-retry>Retry</button>' : ''}
    `;

    const retryButton = card.querySelector('[data-retry]');
    if (retryButton) {
      retryButton.addEventListener('click', run);
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
