// Loaded from the UMD <script> tag in index.html (not imported as an ES
// module from a CDN). This is deliberate: jsDelivr's `+esm` conversion of
// @supabase/supabase-js has an open bug (as of writing) where its auth
// module resolves to `null` at runtime in the browser, breaking sign-in
// specifically — the one thing this app needs most. The classic UMD build,
// loaded as a plain <script src="...">, doesn't go through that conversion
// and has been the stable distribution method for years. See index.html
// for the script tag; by the time this module runs, `window.supabase`
// is guaranteed to already exist.
const { createClient } = window.supabase;

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const PLACEHOLDER_URL = 'https://your-project-ref.supabase.co';
const PLACEHOLDER_KEY = 'your-publishable-or-anon-key';

export const isSupabaseConfigured =
  Boolean(SUPABASE_URL && SUPABASE_KEY) &&
  SUPABASE_URL !== PLACEHOLDER_URL &&
  SUPABASE_KEY !== PLACEHOLDER_KEY;

// Falls back to harmless placeholder values so createClient never throws,
// even before config.js has been filled in. isSupabaseConfigured (above) is
// what the app actually checks before relying on real requests — see
// connection-status.js.
export const supabase = createClient(
  isSupabaseConfigured ? SUPABASE_URL : PLACEHOLDER_URL,
  isSupabaseConfigured ? SUPABASE_KEY : PLACEHOLDER_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // true (the default) — needed so a session that comes back from a
      // Google/Apple OAuth redirect is picked up automatically on load.
      detectSessionInUrl: true,
    },
  }
);
