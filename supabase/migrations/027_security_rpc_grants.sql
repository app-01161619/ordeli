begin;

-- RPCs are SECURITY DEFINER and therefore must never retain the PostgreSQL
-- default EXECUTE privilege granted to PUBLIC.  Customer-facing RPCs are
-- explicitly granted to anon/authenticated, seller/member RPCs to
-- authenticated only, and internal trigger/helper functions to nobody.

-- Seller/member/offline RPCs
revoke all on function public.sync_offline_order_v4(text,text,text,uuid,text,text,integer,numeric) from public, anon, authenticated;
grant execute on function public.sync_offline_order_v4(text,text,text,uuid,text,text,integer,numeric) to authenticated;

revoke all on function public.sync_offline_order_v5(text,text,text,uuid,text,text,integer,numeric) from public, anon, authenticated;
grant execute on function public.sync_offline_order_v5(text,text,text,uuid,text,text,integer,numeric) to authenticated;

revoke all on function public.create_production_member_invite(text,text,text,boolean,boolean,boolean,boolean) from public, anon, authenticated;
grant execute on function public.create_production_member_invite(text,text,text,boolean,boolean,boolean,boolean) to authenticated;

revoke all on function public.get_current_actor() from public, anon, authenticated;
grant execute on function public.get_current_actor() to authenticated;

revoke all on function public.get_production_work(integer) from public, anon, authenticated;
grant execute on function public.get_production_work(integer) to authenticated;

revoke all on function public.accept_production_member_invite(text) from public, anon, authenticated;
grant execute on function public.accept_production_member_invite(text) to authenticated;

revoke all on function public.production_member_can_upload_to_seller(text) from public, anon, authenticated;
grant execute on function public.production_member_can_upload_to_seller(text) to authenticated;

revoke all on function public.resolve_production_qr(text) from public, anon, authenticated;
grant execute on function public.resolve_production_qr(text) to authenticated;

revoke all on function public.finish_production_stage_member_v2(uuid,text,text) from public, anon, authenticated;
grant execute on function public.finish_production_stage_member_v2(uuid,text,text) to authenticated;

revoke all on function public.update_order_pickup_status(uuid,text) from public, anon, authenticated;
grant execute on function public.update_order_pickup_status(uuid,text) to authenticated;

-- Customer/public tracking RPCs. These are intentionally available without
-- an account, but callers still have to supply the secure QR/invite token.
revoke all on function public.get_customer_fulfillment(text) from public, anon, authenticated;
grant execute on function public.get_customer_fulfillment(text) to anon, authenticated;

revoke all on function public.set_customer_fulfillment(text,text,uuid) from public, anon, authenticated;
grant execute on function public.set_customer_fulfillment(text,text,uuid) to anon, authenticated;

revoke all on function public.get_customer_payment_proof(text) from public, anon, authenticated;
grant execute on function public.get_customer_payment_proof(text) to anon, authenticated;

revoke all on function public.submit_customer_payment_proof(text,numeric,text) from public, anon, authenticated;
grant execute on function public.submit_customer_payment_proof(text,numeric,text) to anon, authenticated;

revoke all on function public.get_customer_post_purchase_actions(text) from public, anon, authenticated;
grant execute on function public.get_customer_post_purchase_actions(text) to anon, authenticated;

revoke all on function public.submit_customer_review(text,integer,text) from public, anon, authenticated;
grant execute on function public.submit_customer_review(text,integer,text) to anon, authenticated;

revoke all on function public.cancel_customer_order_item(text,text) from public, anon, authenticated;
grant execute on function public.cancel_customer_order_item(text,text) to anon, authenticated;

revoke all on function public.get_production_invite(text) from public, anon, authenticated;
grant execute on function public.get_production_invite(text) to anon, authenticated;

revoke all on function public.reschedule_customer_pickup(text,uuid) from public, anon, authenticated;
grant execute on function public.reschedule_customer_pickup(text,uuid) to anon, authenticated;

revoke all on function public.get_customer_stage_proof(text,integer) from public, anon, authenticated;
grant execute on function public.get_customer_stage_proof(text,integer) to anon, authenticated;

-- Seller-only event rescheduling.
revoke all on function public.reschedule_event_orders(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reschedule_event_orders(uuid,uuid,text) to authenticated;

-- Seller-only payment verification.
revoke all on function public.review_customer_payment(uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_customer_payment(uuid,text,text) to authenticated;

-- Internal SMS helper/trigger functions: never callable through the API.
revoke all on function public.queue_sms_update(uuid,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.trg_order_item_sms_update() from public, anon, authenticated;
revoke all on function public.trg_stage_log_sms_update() from public, anon, authenticated;
revoke all on function public.trg_payment_sms_update() from public, anon, authenticated;
revoke all on function public.trg_order_pickup_sms_update() from public, anon, authenticated;
revoke all on function public.trg_event_schedule_sms_update() from public, anon, authenticated;

-- Defensive cleanup for the deliberately removed rework feature.
drop function if exists public.send_back_production_stage_member_v2(uuid);

notify pgrst, 'reload schema';
commit;
