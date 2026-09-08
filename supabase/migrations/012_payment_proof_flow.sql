begin;

-- Private bucket for customer-uploaded payment proofs.
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do update set public = false;

-- Customers authenticate to storage only through their unguessable tracking token in the object path:
-- incoming/<public_token>/<uuid>.<ext>
drop policy if exists "customer_can_upload_payment_proofs" on storage.objects;
create policy "customer_can_upload_payment_proofs"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'payment-proofs'
  and split_part(name, '/', 1) = 'incoming'
  and nullif(split_part(name, '/', 2), '') is not null
  and exists (
    select 1
    from public.qr_codes q
    where q.public_token = split_part(name, '/', 2)
      and q.status = 'assigned'
      and q.order_item_id is not null
  )
);

drop policy if exists "seller_can_read_payment_proofs" on storage.objects;
create policy "seller_can_read_payment_proofs"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'payment-proofs'
  and exists (
    select 1
    from public.payments p
    where p.proof_path = storage.objects.name
      and p.seller_id = auth.uid()
  )
);

drop policy if exists "seller_can_delete_payment_proofs" on storage.objects;
create policy "seller_can_delete_payment_proofs"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'payment-proofs'
  and exists (
    select 1
    from public.payments p
    where p.proof_path = storage.objects.name
      and p.seller_id = auth.uid()
  )
);

create or replace function public.get_customer_payment_proof(p_public_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr public.qr_codes%rowtype;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_total numeric(12,2) := 0;
  v_paid numeric(12,2) := 0;
  v_remaining numeric(12,2) := 0;
  v_items_total integer := 0;
  v_items_complete integer := 0;
  v_pending boolean := false;
  v_rejected boolean := false;
  v_rejection_reason text := null;
begin
  select q.* into v_qr
  from public.qr_codes q
  where q.public_token = p_public_token
    and q.status = 'assigned'
    and q.order_item_id is not null
  limit 1;
  if not found then raise exception 'This tracking link is unavailable.'; end if;

  select oi.* into v_item from public.order_items oi where oi.id = v_qr.order_item_id;
  if not found then raise exception 'This tracking link is unavailable.'; end if;
  select * into v_order from public.orders where id = v_item.order_id;
  if not found then raise exception 'This order is unavailable.'; end if;

  select coalesce(sum(oi.total_price),0)::numeric(12,2), count(*)::integer
    into v_total, v_items_total
  from public.order_items oi
  where oi.order_id = v_order.id and oi.cancelled_at is null;

  select coalesce(sum(p.amount),0)::numeric(12,2)
    into v_paid
  from public.payments p
  where p.order_id = v_order.id
    and (p.proof_status is null or p.proof_status = 'confirmed');

  select count(*)::integer into v_items_complete
  from public.order_items oi
  where oi.order_id = v_order.id
    and oi.cancelled_at is null
    and (
      jsonb_array_length(coalesce(oi.workflow_snapshot,'[]'::jsonb)) = 0
      or (
        select count(*)
        from jsonb_array_elements(coalesce(oi.workflow_snapshot,'[]'::jsonb)) st
        where exists (
          select 1 from public.stage_logs sl
          where sl.order_item_id = oi.id
            and sl.stage_order = (st->>'stage_order')::integer
            and sl.action = 'finished'
            and not exists (
              select 1 from public.stage_logs newer
              where newer.order_item_id = oi.id
                and newer.stage_order = sl.stage_order
                and newer.action = 'sent_back'
                and newer.occurred_at > sl.occurred_at
            )
        )
      ) = jsonb_array_length(coalesce(oi.workflow_snapshot,'[]'::jsonb))
    );

  select exists(
    select 1 from public.payments p
    where p.order_id = v_order.id and p.proof_status = 'pending_verification'
  ) into v_pending;

  select p.rejection_reason
    into v_rejection_reason
  from public.payments p
  where p.order_id = v_order.id and p.proof_status = 'rejected'
  order by p.created_at desc limit 1;
  v_rejected := v_rejection_reason is not null or exists(
    select 1 from public.payments p
    where p.order_id = v_order.id and p.proof_status = 'rejected'
  );

  v_remaining := greatest(v_total - v_paid, 0);

  return jsonb_build_object(
    'eligible', v_order.cancelled_at is null
      and v_order.handed_over_at is null
      and v_items_complete = v_items_total
      and v_remaining > 0,
    'remaining', v_remaining,
    'pending_verification', v_pending,
    'rejected', v_rejected,
    'rejection_reason', v_rejection_reason
  );
end;
$$;

grant execute on function public.get_customer_payment_proof(text) to anon, authenticated;

create or replace function public.submit_customer_payment_proof(
  p_public_token text,
  p_amount numeric,
  p_proof_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr public.qr_codes%rowtype;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_total numeric(12,2) := 0;
  v_paid numeric(12,2) := 0;
  v_remaining numeric(12,2) := 0;
  v_items_total integer := 0;
  v_items_complete integer := 0;
  v_payment_id uuid;
  v_prefix text;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if nullif(trim(coalesce(p_proof_path,'')),'') is null then raise exception 'Payment proof is required.'; end if;

  select q.* into v_qr from public.qr_codes q
  where q.public_token = p_public_token and q.status = 'assigned' and q.order_item_id is not null limit 1;
  if not found then raise exception 'This tracking link is unavailable.'; end if;

  select oi.* into v_item from public.order_items oi where oi.id = v_qr.order_item_id;
  select * into v_order from public.orders where id = v_item.order_id;
  if v_order.cancelled_at is not null then raise exception 'This order has been cancelled.'; end if;
  if v_order.handed_over_at is not null then raise exception 'This order has already been handed over.'; end if;

  v_prefix := 'incoming/' || p_public_token || '/';
  if left(p_proof_path, length(v_prefix)) <> v_prefix then
    raise exception 'Invalid payment proof path.';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'payment-proofs' and name = p_proof_path
  ) then
    raise exception 'Payment proof upload was not found.';
  end if;

  select coalesce(sum(oi.total_price),0)::numeric(12,2), count(*)::integer
    into v_total, v_items_total
  from public.order_items oi
  where oi.order_id = v_order.id and oi.cancelled_at is null;

  select coalesce(sum(p.amount),0)::numeric(12,2)
    into v_paid
  from public.payments p
  where p.order_id = v_order.id
    and (p.proof_status is null or p.proof_status = 'confirmed');

  select count(*)::integer into v_items_complete
  from public.order_items oi
  where oi.order_id = v_order.id and oi.cancelled_at is null
    and (
      jsonb_array_length(coalesce(oi.workflow_snapshot,'[]'::jsonb)) = 0
      or (
        select count(*) from jsonb_array_elements(coalesce(oi.workflow_snapshot,'[]'::jsonb)) st
        where exists (
          select 1 from public.stage_logs sl
          where sl.order_item_id = oi.id
            and sl.stage_order = (st->>'stage_order')::integer
            and sl.action = 'finished'
            and not exists (
              select 1 from public.stage_logs newer
              where newer.order_item_id = oi.id
                and newer.stage_order = sl.stage_order
                and newer.action = 'sent_back'
                and newer.occurred_at > sl.occurred_at
            )
        )
      ) = jsonb_array_length(coalesce(oi.workflow_snapshot,'[]'::jsonb))
    );

  v_remaining := greatest(v_total - v_paid, 0);
  if v_items_complete <> v_items_total then raise exception 'Payment proof can be submitted after production is completed.'; end if;
  if v_remaining <= 0 then raise exception 'This order has no remaining balance.'; end if;
  if p_amount > v_remaining then raise exception 'Payment amount cannot exceed the remaining balance.'; end if;
  if exists (select 1 from public.payments p where p.order_id = v_order.id and p.proof_status = 'pending_verification') then
    raise exception 'A payment proof is already pending verification.';
  end if;

  insert into public.payments(order_id, seller_id, amount, payment_type, proof_status, proof_path, created_at)
  values(v_order.id, v_order.seller_id, p_amount, 'balance', 'pending_verification', p_proof_path, now())
  returning id into v_payment_id;

  return jsonb_build_object('payment_id', v_payment_id, 'status', 'pending_verification', 'amount', p_amount);
end;
$$;

grant execute on function public.submit_customer_payment_proof(text, numeric, text) to anon, authenticated;

create or replace function public.review_customer_payment(
  p_payment_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required.'; end if;
  if p_decision not in ('confirmed','rejected') then raise exception 'Invalid payment review decision.'; end if;

  select * into v_payment from public.payments where id = p_payment_id and seller_id = v_user for update;
  if not found then raise exception 'Payment not found.'; end if;
  if v_payment.proof_status <> 'pending_verification' then raise exception 'This payment proof is no longer pending.'; end if;

  update public.payments
  set proof_status = p_decision,
      rejection_reason = case when p_decision = 'rejected' then nullif(trim(coalesce(p_rejection_reason,'')),'') else null end,
      confirmed_by_user_id = case when p_decision = 'confirmed' then v_user else null end,
      confirmed_at = case when p_decision = 'confirmed' then now() else null end
  where id = p_payment_id;

  return jsonb_build_object('payment_id', p_payment_id, 'status', p_decision);
end;
$$;

grant execute on function public.review_customer_payment(uuid, text, text) to authenticated;

commit;
