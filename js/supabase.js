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
    }
  } catch (_) {}
  return null;
}

function offlineError() {
  return new Error("Supabase network access is unavailable while offline.");
}

function createOfflineStub() {
  const auth = {
    async getSession() {
      return { data: { session: readPersistedSession() }, error: null };
    },
    async getUser() {
      const session = readPersistedSession();
      return session?.user
        ? { data: { user: session.user }, error: null }
        : { data: { user: null }, error: null };
    },
    async signOut() {
      return { error: null };
    },
    async signInWithPassword() {
      return { data: null, error: offlineError() };
    },
    async signUp() {
      return { data: null, error: offlineError() };
    },
    async signInWithOAuth() {
      return { data: null, error: offlineError() };
    },
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } };
    }
  };

  const fail = () => { throw offlineError(); };
  return {
    auth,
    from: fail,
    rpc: fail,
    storage: {
      from: fail
    }
  };
}

let client = null;
let supabaseReady = false;

if (navigator.onLine) {
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    client = mod.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    supabaseReady = true;
  } catch (error) {
    console.warn("Supabase client unavailable; booting in offline mode.", error);
  }
}

export const supabase = client || createOfflineStub();
export const isSupabaseReady = supabaseReady;
export { readPersistedSession };
