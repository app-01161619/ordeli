-- Ordeli fixes: offline production item ID resolution is handled by the client.
-- This migration fixes public tracking/payment semantics and removes an unnecessary
-- anonymous execute grant from a seller-only SECURITY DEFINER function.

CREATE OR REPLACE FUNCTION public.get_customer_tracking(p_public_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_latest_proof_path text;
  v_total numeric(12,2) := 0;
  v_paid numeric(12,2) := 0;
  v_payment_status text;
  v_target_stage integer;
  v_stage_status text;
  v_all_done boolean := true;
  v_has_active_stage boolean := false;
  v_payment_history jsonb := '[]'::jsonb;
begin
  if p_public_token is null or length(trim(p_public_token)) < 16 then
    raise exception 'Invalid tracking link.' using errcode = '22023';
  end if;

  select *
  into v_qr
  from public.qr_codes
  where public_token = trim(p_public_token)
    and status = 'assigned'
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

  -- Only cash/directly-recorded or seller-confirmed payments count toward
  -- the customer-visible paid total. Pending/rejected proof is not paid.
  select
    coalesce(sum(oi.total_price), 0),
    coalesce((
      select sum(p.amount)
      from public.payments p
      where p.order_id = v_order.id
        and p.seller_id = v_order.seller_id
        and (p.proof_status is null or p.proof_status = 'confirmed')
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

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'amount', round(p.amount, 2),
      'payment_type', p.payment_type,
      'payment_method', p.payment_method,
      'proof_status', p.proof_status,
      'rejection_reason', case when p.proof_status = 'rejected' then p.rejection_reason else null end,
      'created_at', p.created_at,
      'source', case when p.proof_path is not null then 'customer' else 'seller' end
    ) order by p.created_at desc
  ), '[]'::jsonb)
  into v_payment_history
  from public.payments p
  where p.order_id = v_order.id
    and p.seller_id = v_order.seller_id;

  if jsonb_typeof(v_item.workflow_snapshot) = 'array' then
    for v_stage in
      select value
      from jsonb_array_elements(v_item.workflow_snapshot)
      order by (value->>'stage_order')::integer
    loop
      v_target_stage := (v_stage->>'stage_order')::integer;

      select sl.action, sl.occurred_at, sl.proof_photo_path
      into v_latest_action, v_latest_at, v_latest_proof_path
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
        null;
      else
        v_all_done := false;
      end if;

      v_stages := v_stages || jsonb_build_array(
        jsonb_build_object(
          'stage_order', v_target_stage,
          'name', coalesce(v_stage->>'name', 'Stage'),
          'status', v_stage_status,
          'has_photo', (v_stage_status = 'finished' and v_latest_proof_path is not null),
          'finished_at', case when v_stage_status = 'finished' then v_latest_at else null end
        )
      );
    end loop;
  end if;

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
      'status', v_payment_status,
      'history', v_payment_history
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_stage_proof_v2(p_public_token text, p_stage_order integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_item_id uuid;
  v_stage_name text;
  v_path text;
begin
  if p_public_token is null or btrim(p_public_token) = '' or p_stage_order is null or p_stage_order < 1 then
    return jsonb_build_object('available', false);
  end if;

  select q.order_item_id
    into v_order_item_id
  from public.qr_codes q
  where q.public_token = p_public_token
    and q.order_item_id is not null
    and q.status = 'assigned'
  limit 1;

  if v_order_item_id is null then
    return jsonb_build_object('available', false);
  end if;

  -- Return the proof photo only when the latest state for this stage is
  -- still a finished state. A later send-back invalidates the older proof.
  select sl.stage_name, sl.proof_photo_path
    into v_stage_name, v_path
  from public.stage_logs sl
  where sl.order_item_id = v_order_item_id
    and sl.stage_order = p_stage_order
    and sl.action = 'finished'
    and sl.proof_photo_path is not null
    and not exists (
      select 1
      from public.stage_logs newer
      where newer.order_item_id = sl.order_item_id
        and newer.stage_order = sl.stage_order
        and newer.occurred_at > sl.occurred_at
        and newer.action = 'sent_back'
    )
  order by sl.occurred_at desc
  limit 1;

  if v_path is null then
    return jsonb_build_object(
      'available', false,
      'stage_name', coalesce(v_stage_name, 'Stage ' || p_stage_order)
    );
  end if;

  return jsonb_build_object(
    'available', true,
    'path', v_path,
    'stage_name', coalesce(v_stage_name, 'Stage ' || p_stage_order)
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_seller_payment_method(uuid, text) FROM anon;

REVOKE EXECUTE ON FUNCTION public.set_seller_payment_method(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_seller_payment_method(uuid, text) TO authenticated;
