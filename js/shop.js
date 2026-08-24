import { supabase } from './supabase-client.js';

/**
 * Returns { shop, role, memberId } — role is 'owner' | 'production_member' | null.
 * memberId is the caller's own production_members.id when role is
 * 'production_member' (needed for order_item_stages.finished_by), else null.
 * shop is null if the signed-in user (a first-time sign-in) hasn't
 * finished onboarding yet.
 */
export async function resolveMyShop(session) {
  if (!session) {
    return { shop: null, role: null, memberId: null, error: null };
  }

  const owned = await supabase
    .from('shops')
    .select('*')
    .eq('owner_id', session.user.id)
    .maybeSingle();

  if (owned.error) {
    return { shop: null, role: null, memberId: null, error: owned.error.message };
  }
  if (owned.data) {
    return { shop: owned.data, role: 'owner', memberId: null, error: null };
  }

  const membership = await supabase
    .from('production_members')
    .select('id, shops(*)')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (membership.error) {
    return { shop: null, role: null, memberId: null, error: membership.error.message };
  }

  const memberShop = membership.data?.shops ?? null;
  if (memberShop) {
    return { shop: memberShop, role: 'production_member', memberId: membership.data.id, error: null };
  }

  return { shop: null, role: null, memberId: null, error: null };
}

// The router's auth guard needs to know "does this user have a shop yet"
// on every single navigation, and each page re-checks it too. Without a
// cache, switching tabs would double the number of requests for no reason.
let cache = { userId: null, result: null };

export async function getMyShop(session) {
  if (!session) {
    cache = { userId: null, result: null };
    return { shop: null, role: null, memberId: null, error: null };
  }

  if (cache.userId === session.user.id && cache.result) {
    return cache.result;
  }

  const result = await resolveMyShop(session);
  cache = { userId: session.user.id, result };
  return result;
}

/** Call after creating the shops row in onboarding, or on sign-out. */
export function invalidateShopCache() {
  cache = { userId: null, result: null };
}
