begin;

create or replace function public.get_customer_stage_proof(
  p_public_token text,
  p_stage_order integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_qr public.qr_codes%rowtype;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_path text;
  v_url text;
  v_stage_name text;
begin
  if p_public_token is null or length(trim(p_public_token)) < 16 then
    raise exception 'Invalid tracking link.' using errcode = '22023';
  end if;
  if p_stage_order is null or p_stage_order < 1 then
    raise exception 'Invalid production stage.' using errcode = '22023';
  end if;

  select q.* into v_qr
  from public.qr_codes q
  where q.public_token = trim(p_public_token)
    and q.status in ('assigned','revoked')
    and q.order_item_id is not null
  limit 1;
  if not found then
    raise exception 'Tracking link not found or no longer available.' using errcode = 'P0002';
  end if;

  select oi.* into v_item
  from public.order_items oi
  where oi.id = v_qr.order_item_id
    and oi.seller_id = v_qr.seller_id
    and oi.cancelled_at is null
  limit 1;
  if not found then
    raise exception 'Tracked order item was not found.' using errcode = 'P0002';
  end if;

  select o.* into v_order
  from public.orders o
  where o.id = v_item.order_id
    and o.seller_id = v_qr.seller_id
    and o.cancelled_at is null
  limit 1;
  if not found then
    raise exception 'Tracked order was not found.' using errcode = 'P0002';
  end if;

  select sl.proof_photo_path, sl.stage_name
    into v_path, v_stage_name
  from public.stage_logs sl
  where sl.order_item_id = v_item.id
    and sl.stage_order = p_stage_order
    and sl.action = 'finished'
    and sl.proof_photo_path is not null
    and not exists (
      select 1
      from public.stage_logs newer
      where newer.order_item_id = sl.order_item_id
        and newer.stage_order = sl.stage_order
        and newer.action = 'finished'
        and newer.occurred_at > sl.occurred_at
    )
  order by sl.occurred_at desc
  limit 1;

  if v_path is null then
    return jsonb_build_object(
      'available', false,
      'stage_order', p_stage_order,
      'stage_name', v_stage_name
    );
  end if;

  -- Proof photos are stored privately. Create a short-lived URL only after
  -- the supplied customer token has been validated against the exact item.
  select signedurl into v_url
  from storage.create_signed_url(v_path, 600);

  if v_url is null then
    raise exception 'Unable to prepare the proof photo.';
  end if;

  return jsonb_build_object(
    'available', true,
    'stage_order', p_stage_order,
    'stage_name', v_stage_name,
    'url', v_url,
    'expires_in', 600
  );
end;
$$;

revoke all on function public.get_customer_stage_proof(text, integer) from public;
grant execute on function public.get_customer_stage_proof(text, integer) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
