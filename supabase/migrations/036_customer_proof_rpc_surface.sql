-- Close the remaining direct customer proof RPC surface.
-- The customer UI now uses the Cloudflare Worker endpoint, which calls the
-- hardened v2 RPC with the server key and creates the short-lived Storage URL.

begin;

revoke all on function public.get_customer_stage_proof(text, integer) from public, anon, authenticated;

grant execute on function public.get_customer_stage_proof_v2(text, integer) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
