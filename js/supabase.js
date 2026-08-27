import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://kbgdxhshxkhuelbxlggc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_KJDx4oVgNF6z_5SYvyI-uw_h58jlimx";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
