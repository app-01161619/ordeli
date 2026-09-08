begin;

create or replace function public.send_back_production_stage_member_v2(
  p_order_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.production_members%rowtype;
  v_item public.order_items%rowtype;
  v_latest public.stage_logs%rowtype;
begin
  select * into v_member
  from public.production_members
  where auth_user_id = auth.uid()
    and is_active = true
  limit 1;

  if not found then
    raise exception 'This account is not linked to an active production-team member.';
  end if;

  if not v_member.can_finish_stage then
    raise exception 'You do not have permission to send production stages back.';
  end if;

  select * into v_item
  from public.order_items
  where id = p_order_item_id
    and seller_id = v_member.seller_id
    and cancelled_at is null
  for update;

  if not found then
    raise exception 'Production item not found.';
  end if;

  select sl.*
    into v_latest
  from public.stage_logs sl
  where sl.order_item_id = v_item.id
    and sl.action = 'finished'
    and not exists (
      select 1
      from public.stage_logs newer
      where newer.order_item_id = sl.order_item_id
        and newer.stage_order = sl.stage_order
        and newer.action = 'sent_back'
        and newer.occurred_at > sl.occurred_at
    )
  order by sl.stage_order desc, sl.occurred_at desc
  limit 1;

  if not found then
    raise exception 'There is no finished stage available to send back.';
  end if;

  insert into public.stage_logs(
    order_item_id,
    stage_order,
    stage_name,
    action,
    performed_by_user_id,
    occurred_at
  )
  values (
    v_item.id,
    v_latest.stage_order,
    v_latest.stage_name,
    'sent_back',
    auth.uid(),
    now()
  );

  return jsonb_build_object(
    'order_item_id', v_item.id,
    'stage_order', v_latest.stage_order,
    'stage_name', v_latest.stage_name,
    'action', 'sent_back'
  );
end;
$$;

grant execute on function public.send_back_production_stage_member_v2(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
