const SUPABASE_URL = "https://kbgdxhshxkhuelbxlggc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_KJDx4oVgNF6z_5SYvyI-uw_h58jlimx";

function readPersistedSession() {
  try {
    const keys = Object.keys(localStorage).filter((key) => /^sb-.+-auth-token$/.test(key));
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed?.user?.id) return parsed;
      if (parsed?.currentSession?.user?.id) return parsed.currentSession;
      if (parsed?.session?.user?.id) return parsed.session;
    }
  } catch (_) {}
  return null;
}

function offlineError() {
  return new Error("Supabase network access is unavailable while offline.");
}

let client = null;
let clientPromise = null;
const pendingAuthListeners = new Set();

async function ensureSupabase() {
  if (client) return client;
  if (!navigator.onLine) throw offlineError();
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    try {
      const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
      client = mod.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      for (const callback of pendingAuthListeners) {
        try { client.auth.onAuthStateChange(callback); } catch (_) {}
      }
      pendingAuthListeners.clear();
      return client;
    } finally {
      clientPromise = null;
    }
  })();
  return clientPromise;
}

const auth = {
  async getSession() {
    const persisted = readPersistedSession();

    // Offline startup must never require a network round-trip.
    if (!navigator.onLine) {
      return { data: { session: persisted?.user?.id ? persisted : null }, error: null };
    }

    // Once the client exists, prefer Supabase's current in-memory session so
    // a refreshed access token is actually used by background synchronization.
    if (client) {
      try {
        const live = await client.auth.getSession();
        if (live?.data?.session?.user?.id) return live;
      } catch (_) {}
    }

    // On an online first boot, initialize the client and ask Supabase for the
    // authoritative current session. Fall back to persisted auth only if the
    // network/client cannot be initialized.
    try {
      const c = await ensureSupabase();
      const live = await c.auth.getSession();
      if (live?.data?.session?.user?.id) return live;
    } catch (_) {}

    return { data: { session: persisted?.user?.id ? persisted : null }, error: null };
  },
  async getUser() {
    const result = await this.getSession();
    return { data: { user: result?.data?.session?.user || null }, error: result?.error || null };
  },
  async refreshSession() {
    if (!navigator.onLine) return { data: { session: readPersistedSession() }, error: null };
    const c = await ensureSupabase();
    return c.auth.refreshSession();
  },
  async signOut() {
    try {
      if (client) return await client.auth.signOut();
      // Explicit logout must also clear the persisted Supabase session locally.
      try {
        const keys = Object.keys(localStorage).filter((key) => /^sb-.+-auth-token$/.test(key));
        keys.forEach((key) => localStorage.removeItem(key));
      } catch (_) {}
      return { error: null };
    } catch (error) {
      return { error };
    }
  },
  async signInWithPassword(...args) { return (await ensureSupabase()).auth.signInWithPassword(...args); },
  async signUp(...args) { return (await ensureSupabase()).auth.signUp(...args); },
  async signInWithOAuth(...args) { return (await ensureSupabase()).auth.signInWithOAuth(...args); },
  onAuthStateChange(callback) {
    if (client) return client.auth.onAuthStateChange(callback);
    pendingAuthListeners.add(callback);
    return { data: { subscription: { unsubscribe() { pendingAuthListeners.delete(callback); } } } };
  }
};

export const supabase = {
  auth,
  from(...args) { if (!client) throw offlineError(); return client.from(...args); },
  rpc(...args) { if (!client) throw offlineError(); return client.rpc(...args); },
  storage: { from(...args) { if (!client) throw offlineError(); return client.storage.from(...args); } }
};

export { readPersistedSession, ensureSupabase };
