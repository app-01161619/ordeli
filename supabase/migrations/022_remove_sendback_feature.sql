begin;

-- Remove the server-side send-back RPC introduced for production rework.
drop function if exists public.send_back_production_stage_member_v2(uuid);

commit;
