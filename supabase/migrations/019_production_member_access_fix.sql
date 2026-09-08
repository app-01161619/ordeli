begin;

create or replace function public.get_current_actor()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.production_members%rowtype;
  v_seller public.sellers%rowtype;
begin
  if auth.uid() is null then return null; end if;

  select * into v_member
  from public.production_members
  where auth_user_id = auth.uid() and is_active = true
  limit 1;

  if found then
    return jsonb_build_object(
      'actor_type','production_member', 'user_id',auth.uid(), 'seller_id',v_member.seller_id,
      'member_id',v_member.id, 'name',v_member.name, 'email',v_member.email,
      'section_label',v_member.section_label, 'role',coalesce(v_member.role,'production_member'),
      'can_view_production',coalesce(v_member.can_view_production,false),
      'can_scan_qr',coalesce(v_member.can_scan_qr,false),
      'can_finish_stage',coalesce(v_member.can_finish_stage,false),
      'can_upload_proof',coalesce(v_member.can_upload_proof,false)
    );
  end if;

  select * into v_seller from public.sellers where id = auth.uid() limit 1;
  if found then
    return jsonb_build_object(
      'actor_type','seller', 'user_id',auth.uid(), 'seller_id',auth.uid(),
      'name',coalesce(v_seller.shop_name,'Seller'),
      'can_view_production',true,'can_scan_qr',true,'can_finish_stage',true,'can_upload_proof',true
    );
  end if;

  return null;
end;
$$;

grant execute on function public.get_current_actor() to authenticated;

create or replace function public.get_production_work(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.production_members%rowtype;
  v_result jsonb;
begin
  select * into v_member
  from public.production_members
  where auth_user_id = auth.uid() and is_active = true
  limit 1;

  if not found then raise exception 'This account is not linked to an active production-team member.'; end if;
  if coalesce(v_member.can_view_production,false) = false then raise exception 'This production account does not have production-view permission.'; end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at asc),'[]'::jsonb) into v_result
  from (
    select oi.id as order_item_id, o.order_number, c.name as customer_name, oi.product_name, oi.quantity, oi.created_at, st.stage_order, st.stage_name
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.customers c on c.id = o.customer_id
    cross join lateral (
      select (stage->>'stage_order')::integer as stage_order, stage->>'name' as stage_name
      from jsonb_array_elements(coalesce(oi.workflow_snapshot,'[]'::jsonb)) stage
      where not exists (
        select 1 from public.stage_logs sl
        where sl.order_item_id=oi.id and sl.stage_order=(stage->>'stage_order')::integer and sl.action='finished'
        and not exists (select 1 from public.stage_logs newer where newer.order_item_id=sl.order_item_id and newer.stage_order=sl.stage_order and newer.action='sent_back' and newer.occurred_at>sl.occurred_at)
      )
      order by (stage->>'stage_order')::integer limit 1
    ) st
    where oi.seller_id=v_member.seller_id and oi.cancelled_at is null and o.cancelled_at is null
    limit greatest(1,least(coalesce(p_limit,100),500))
  ) x;

  return v_result;
end;
$$;

grant execute on function public.get_production_work(integer) to authenticated;

notify pgrst, 'reload schema';
commit;
