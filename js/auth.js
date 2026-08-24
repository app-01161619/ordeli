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
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUpWithPassword(email, password) {
  return supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
}

export async function signOut() {
  await supabase.auth.signOut();
}
