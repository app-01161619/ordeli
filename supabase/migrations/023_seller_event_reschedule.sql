begin;

create or replace function public.reschedule_event_orders(
  p_event_id uuid,
  p_new_event_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_old public.events%rowtype;
  v_new public.events%rowtype;
  v_order_count integer := 0;
  v_moved_order_ids uuid[] := '{}'::uuid[];
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_user is null then
    raise exception 'Authentication required.';
  end if;
  if p_event_id is null or p_new_event_id is null or p_event_id = p_new_event_id then
    raise exception 'Choose a different event.';
  end if;

  select * into v_old
  from public.events
  where id = p_event_id and seller_id = v_user
  for update;
  if not found then
    raise exception 'Original event not found.';
  end if;

  select * into v_new
  from public.events
  where id = p_new_event_id and seller_id = v_user
  for update;
  if not found then
    raise exception 'New event not found.';
  end if;

  if lower(coalesce(v_new.status, '')) not in ('upcoming','ready','active') then
    raise exception 'The new event is not available for pickup.';
  end if;
  if v_new.event_date < current_date then
    raise exception 'The new event must be today or in the future.';
  end if;

  select coalesce(array_agg(o.id), '{}'::uuid[]) into v_moved_order_ids
  from public.orders o
  where o.seller_id = v_user
    and o.event_id = v_old.id
    and o.cancelled_at is null
    and o.handed_over_at is null;

  v_order_count := coalesce(array_length(v_moved_order_ids, 1), 0);

  if v_order_count > 0 then
    update public.orders
    set event_id = v_new.id,
        pickup_status = 'scheduled',
        updated_at = now()
    where seller_id = v_user
      and id = any(v_moved_order_ids);

    insert into public.order_event_history(order_id, old_event_id, new_event_id, reason, changed_by_user_id, occurred_at)
    select moved_id, v_old.id, v_new.id,
           coalesce(v_reason, 'Seller rescheduled event'),
           v_user, now()
    from unnest(v_moved_order_ids) as moved_id;
  end if;

  insert into public.event_change_logs(
    event_id,
    original_event_date,
    original_start_time,
    original_end_time,
    new_event_date,
    new_start_time,
    new_end_time,
    reason,
    changed_by_user_id,
    occurred_at
  ) values (
    v_old.id,
    v_old.event_date,
    v_old.start_time,
    v_old.end_time,
    v_new.event_date,
    v_new.start_time,
    v_new.end_time,
    coalesce(v_reason, 'Seller rescheduled event'),
    v_user,
    now()
  );

  update public.events
  set status = 'cancelled', updated_at = now()
  where id = v_old.id;

  return jsonb_build_object(
    'old_event_id', v_old.id,
    'new_event_id', v_new.id,
    'orders_moved', v_order_count,
    'reason', coalesce(v_reason, 'Seller rescheduled event')
  );
end;
$$;

grant execute on function public.reschedule_event_orders(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
