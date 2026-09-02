-- ============================================================
-- Customer-facing tracking by secure public QR token.
-- The function exposes only customer-safe order/tracking data.
-- Run after the existing master/order/payment schema.
-- ============================================================

create or replace function public.get_customer_tracking(
  p_public_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr public.qr_codes%rowtype;
  v_order public.orders%rowtype;
  v_seller public.sellers%rowtype;
  v_item public.order_items%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_stages jsonb := '[]'::jsonb;
  v_stage jsonb;
  v_latest_action text;
  v_latest_at timestamptz;
  v_total numeric(12,2) := 0;
  v_paid numeric(12,2) := 0;
  v_payment_status text;
  v_target_stage integer;
  v_stage_status text;
  v_all_done boolean := true;
  v_has_active_stage boolean := false;
begin

  if p_public_token is null or length(trim(p_public_token)) < 16 then
    raise exception 'Invalid tracking link.' using errcode = '22023';
  end if;

  select *
  into v_qr
  from public.qr_codes
  where public_token = trim(p_public_token)
    and status in ('assigned', 'revoked')
    and order_item_id is not null;

  if not found then
    raise exception 'Tracking link not found or no longer available.' using errcode = 'P0002';
  end if;

  select *
  into v_item
  from public.order_items
  where id = v_qr.order_item_id
    and seller_id = v_qr.seller_id;

  if not found then
    raise exception 'Tracked order item was not found.' using errcode = 'P0002';
  end if;

  select *
  into v_order
  from public.orders
  where id = v_item.order_id
    and seller_id = v_qr.seller_id;

  if not found then
    raise exception 'Tracked order was not found.' using errcode = 'P0002';
  end if;

  select *
  into v_seller
  from public.sellers
  where id = v_qr.seller_id;

  if not found then
    raise exception 'Shop was not found.' using errcode = 'P0002';
  end if;

  -- Payment totals are customer-visible, but payment proof files are never exposed.
  select
    coalesce(sum(oi.total_price), 0),
    coalesce((
      select sum(p.amount)
      from public.payments p
      where p.order_id = v_order.id
        and p.seller_id = v_order.seller_id
    ), 0)
  into v_total, v_paid
  from public.order_items oi
  where oi.order_id = v_order.id
    and oi.seller_id = v_order.seller_id
    and oi.cancelled_at is null;

  if v_paid <= 0 then
    v_payment_status := 'unpaid';
  elsif v_paid < v_total then
    if exists (
      select 1
      from public.payments p
      where p.order_id = v_order.id
        and p.seller_id = v_order.seller_id
        and p.proof_status = 'pending_verification'
    ) then
      v_payment_status := 'pending_verification';
    elsif exists (
      select 1
      from public.payments p
      where p.order_id = v_order.id
        and p.seller_id = v_order.seller_id
        and p.proof_status = 'rejected'
    ) then
      v_payment_status := 'rejected';
    else
      v_payment_status := 'partially_paid';
    end if;
  else
    v_payment_status := 'fully_paid';
  end if;

  -- Build the specific item's production timeline from its immutable workflow snapshot.
  if jsonb_typeof(v_item.workflow_snapshot) = 'array' then
    for v_stage in
      select value
      from jsonb_array_elements(v_item.workflow_snapshot)
      order by (value->>'stage_order')::integer
    loop
      v_target_stage := (v_stage->>'stage_order')::integer;

      select sl.action, sl.occurred_at
      into v_latest_action, v_latest_at
      from public.stage_logs sl
      where sl.order_item_id = v_item.id
        and sl.stage_order = v_target_stage
      order by sl.occurred_at desc
      limit 1;

      if v_latest_action = 'finished' then
        v_stage_status := 'finished';
      else
        if v_all_done and not v_has_active_stage then
          v_stage_status := 'in_progress';
          v_has_active_stage := true;
        else
          v_stage_status := 'upcoming';
          v_all_done := false;
        end if;
      end if;

      if v_stage_status = 'finished' then
        -- Keep v_all_done unchanged until we inspect the next stage.
        null;
      else
        v_all_done := false;
      end if;

      v_stages := v_stages || jsonb_build_array(
        jsonb_build_object(
          'stage_order', v_target_stage,
          'name', coalesce(v_stage->>'name', 'Stage'),
          'status', v_stage_status,
          'finished_at', case
            when v_stage_status = 'finished' then v_latest_at
            else null
          end
        )
      );
    end loop;
  end if;

  -- All workflow stages finished means the tracked item is production-complete.
  if jsonb_array_length(v_stages) > 0
     and not exists (
       select 1
       from jsonb_array_elements(v_stages) s
       where s->>'status' <> 'finished'
     ) then
    v_all_done := true;
  else
    v_all_done := false;
  end if;

  -- Entire-order summary for the optional "View My Order" view.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'product_name', oi.product_name,
        'quantity', oi.quantity,
        'cancelled', oi.cancelled_at is not null,
        'production_status', case
          when oi.cancelled_at is not null then 'cancelled'
          when jsonb_typeof(oi.workflow_snapshot) <> 'array'
               or jsonb_array_length(oi.workflow_snapshot) = 0 then 'pending'
          when not exists (
            select 1
            from jsonb_array_elements(oi.workflow_snapshot) s
            where not exists (
              select 1
              from public.stage_logs sl
              where sl.order_item_id = oi.id
                and sl.stage_order = (s->>'stage_order')::integer
                and sl.action = 'finished'
                and sl.occurred_at = (
                  select max(sl2.occurred_at)
                  from public.stage_logs sl2
                  where sl2.order_item_id = oi.id
                    and sl2.stage_order = sl.stage_order
                )
            )
          ) then 'completed'
          else 'in_progress'
        end
      )
      order by oi.created_at
    ),
    '[]'::jsonb
  )
  into v_items
  from public.order_items oi
  where oi.order_id = v_order.id
    and oi.seller_id = v_order.seller_id;

  return jsonb_build_object(
    'shop', jsonb_build_object(
      'name', v_seller.shop_name,
      'address', v_seller.shop_address
    ),
    'order', jsonb_build_object(
      'order_number', v_order.order_number,
      'created_at', v_order.created_at,
      'cancelled_at', v_order.cancelled_at,
      'fulfillment_type', v_order.fulfillment_type,
      'pickup_status', v_order.pickup_status
    ),
    'item', jsonb_build_object(
      'id', v_item.id,
      'product_name', v_item.product_name,
      'quantity', v_item.quantity,
      'total_price', v_item.total_price,
      'cancelled_at', v_item.cancelled_at,
      'production_completed', v_all_done,
      'production_stages', v_stages
    ),
    'order_items', v_items,
    'payment', jsonb_build_object(
      'total', round(v_total, 2),
      'paid', round(v_paid, 2),
      'remaining', round(greatest(v_total - v_paid, 0), 2),
      'status', v_payment_status
    )
  );
end;
$$;

revoke all on function public.get_customer_tracking(text) from public;
grant execute on function public.get_customer_tracking(text) to anon, authenticated;
