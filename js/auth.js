import { supabase } from './supabase-client.js';

/** Simple pub/sub so any page can react to session changes. */
const listeners = new Set();

let currentSession = null;
let isInitialized = false;

export function onAuthChange(callback) {
  listeners.add(callback);
  if (isInitialized) {
    // Immediately hand the current state to a late subscriber.
    callback(currentSession);
  }
  return () => listeners.delete(callback);
}

function setSession(session) {
  currentSession = session;
  for (const callback of listeners) {
    callback(currentSession);
  }
}

export function getSession() {
  return currentSession;
}

export function isInitializedYet() {
  return isInitialized;
}

/** Call once, at app startup. */
export async function initAuth() {
  const { data } = await supabase.auth.getSession();
  currentSession = data.session;
  isInitialized = true;
  setSession(currentSession);

  supabase.auth.onAuthStateChange((_event, session) => {
    setSession(session);
  });
}

export async function signInWithPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

/**
 * Returns { session, error }. `session` is null if your Supabase project
 * has "Confirm email" turned on — there's no session until the user clicks
 * the link in their inbox and comes back to sign in for real.
 */
export async function signUpWithPassword(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    return { session: null, error: error.message };
  }
  return { session: data.session, error: null, userId: data.user?.id ?? null };
}

export async function signOut() {
  await supabase.auth.signOut();
}
