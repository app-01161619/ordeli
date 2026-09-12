create or replace function public.get_customer_payment_proof(p_public_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr public.qr_codes%rowtype; v_item public.order_items%rowtype; v_order public.orders%rowtype;
  v_total numeric(12,2):=0; v_paid numeric(12,2):=0; v_remaining numeric(12,2):=0;
  v_latest_status text; v_latest_reason text;
begin
  select * into v_qr from public.qr_codes q where q.public_token=p_public_token and q.status='assigned' and q.order_item_id is not null limit 1;
  if not found then raise exception 'This tracking link is unavailable.'; end if;
  select * into v_item from public.order_items where id=v_qr.order_item_id;
  if not found then raise exception 'This tracking link is unavailable.'; end if;
  select * into v_order from public.orders where id=v_item.order_id;
  if not found then raise exception 'This order is unavailable.'; end if;
  select coalesce(sum(total_price),0)::numeric(12,2) into v_total from public.order_items where order_id=v_order.id and cancelled_at is null;
  select coalesce(sum(amount),0)::numeric(12,2) into v_paid from public.payments where order_id=v_order.id and (proof_status is null or proof_status='confirmed');
  select proof_status,rejection_reason into v_latest_status,v_latest_reason from public.payments where order_id=v_order.id order by created_at desc,id desc limit 1;
  v_remaining:=greatest(v_total-v_paid,0);
  return jsonb_build_object('eligible',v_order.cancelled_at is null and v_order.handed_over_at is null and v_remaining>0,'remaining',v_remaining,'pending_verification',v_latest_status='pending_verification','rejected',v_latest_status='rejected','rejection_reason',case when v_latest_status='rejected' then v_latest_reason else null end);
end; $$;
