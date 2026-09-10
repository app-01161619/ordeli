-- Customer-safe lookup for a finished stage proof.
-- Returns the private storage path; the Cloudflare Worker signs the URL.
create or replace function public.get_customer_stage_proof_v2(
  p_public_token text,
  p_stage_order integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    and q.status in ('assigned', 'revoked')
  limit 1;

  if v_order_item_id is null then
    return jsonb_build_object('available', false);
  end if;

  select sl.stage_name, sl.proof_photo_path
    into v_stage_name, v_path
  from public.stage_logs sl
  where sl.order_item_id = v_order_item_id
    and sl.stage_order = p_stage_order
    and sl.action = 'finished'
    and sl.proof_photo_path is not null
  order by sl.occurred_at desc
  limit 1;

  if v_path is null then
    return jsonb_build_object('available', false, 'stage_name', coalesce(v_stage_name, 'Stage ' || p_stage_order));
  end if;

  return jsonb_build_object('available', true, 'path', v_path, 'stage_name', coalesce(v_stage_name, 'Stage ' || p_stage_order));
end;
$$;

grant execute on function public.get_customer_stage_proof_v2(text, integer) to anon, authenticated;
