-- ============================================================
-- 009_production_execution.sql
-- Ordeli Step 9: Production execution + proof photos
--
-- Production stages are advanced sequentially from the immutable
-- workflow_snapshot stored on each order item.
-- ============================================================

alter table public.stage_logs enable row level security;

revoke all on public.stage_logs from anon;
grant select, insert, update on public.stage_logs to authenticated;

drop policy if exists "stage_log_insert_own" on public.stage_logs;
create policy "stage_log_insert_own"
on public.stage_logs
for insert to authenticated
with check (
  exists (
    select 1
    from public.order_items oi
    where oi.id = stage_logs.order_item_id
      and oi.seller_id = (select auth.uid())
  )
  and performed_by_user_id = (select auth.uid())
);

drop policy if exists "stage_log_update_own" on public.stage_logs;
create policy "stage_log_update_own"
on public.stage_logs
for update to authenticated
using (
  exists (
    select 1
    from public.order_items oi
    where oi.id = stage_logs.order_item_id
      and oi.seller_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.order_items oi
    where oi.id = stage_logs.order_item_id
      and oi.seller_id = (select auth.uid())
  )
  and performed_by_user_id = (select auth.uid())
);

-- Finish exactly the next available stage for the seller's order item.
-- Returns the newly-created stage log id.
create or replace function public.finish_production_stage(
  p_order_item_id uuid,
  p_stage_order integer,
  p_stage_name text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.order_items%rowtype;
  v_stage jsonb;
  v_log_id uuid;
  v_next_stage_order integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_order_item_id is null or p_stage_order is null or p_stage_order < 1 then
    raise exception 'Invalid production stage.' using errcode = '22023';
  end if;

  select *
  into v_item
  from public.order_items
  where id = p_order_item_id
    and seller_id = auth.uid()
  for update;

  if not found then
    raise exception 'Order item was not found.' using errcode = 'P0002';
  end if;

  if v_item.cancelled_at is not null then
    raise exception 'Cancelled order items cannot be updated.' using errcode = '22023';
  end if;

  if jsonb_typeof(v_item.workflow_snapshot) <> 'array'
     or jsonb_array_length(v_item.workflow_snapshot) = 0 then
    raise exception 'This order item has no production workflow.' using errcode = '22023';
  end if;

  select min((s->>'stage_order')::integer)
  into v_next_stage_order
  from jsonb_array_elements(v_item.workflow_snapshot) s
  where not exists (
    select 1
    from public.stage_logs sl
    where sl.order_item_id = v_item.id
      and sl.stage_order = (s->>'stage_order')::integer
      and sl.action = 'finished'
      and sl.occurred_at = (
        select max(sl2.occurred_at)
        from public.stage_logs sl2
        where sl2.order_item_id = v_item.id
          and sl2.stage_order = sl.stage_order
      )
  );

  if v_next_stage_order is null then
    raise exception 'All production stages are already finished.' using errcode = '22023';
  end if;

  if p_stage_order <> v_next_stage_order then
    raise exception 'Stages must be completed in order. Finish stage % first.', v_next_stage_order
      using errcode = '22023';
  end if;

  select s
  into v_stage
  from jsonb_array_elements(v_item.workflow_snapshot) s
  where (s->>'stage_order')::integer = p_stage_order
  limit 1;

  if v_stage is null then
    raise exception 'Production stage was not found.' using errcode = 'P0002';
  end if;

  if trim(coalesce(p_stage_name, '')) <> trim(coalesce(v_stage->>'name', '')) then
    raise exception 'Production stage name does not match the saved workflow.' using errcode = '22023';
  end if;

  insert into public.stage_logs (
    order_item_id,
    stage_order,
    stage_name,
    action,
    performed_by_user_id,
    note
  )
  values (
    v_item.id,
    p_stage_order,
    trim(v_stage->>'name'),
    'finished',
    auth.uid(),
    nullif(trim(p_note), '')
  )
  returning id into v_log_id;

  return jsonb_build_object(
    'stage_log_id', v_log_id,
    'stage_order', p_stage_order,
    'stage_name', trim(v_stage->>'name')
  );
end;
$$;


-- Send back the most recently completed stage for rework.
create or replace function public.send_back_production_stage(
  p_order_item_id uuid,
  p_stage_order integer,
  p_stage_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.order_items%rowtype;
  v_latest_finished jsonb;
  v_expected_order integer;
  v_log_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into v_item
  from public.order_items
  where id = p_order_item_id
    and seller_id = auth.uid()
  for update;

  if not found then
    raise exception 'Order item was not found.' using errcode = 'P0002';
  end if;

  if v_item.cancelled_at is not null then
    raise exception 'Cancelled order items cannot be updated.' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'stage_order', sl.stage_order,
    'stage_name', sl.stage_name
  )
  into v_latest_finished
  from public.stage_logs sl
  where sl.order_item_id = v_item.id
    and sl.action = 'finished'
    and sl.occurred_at = (
      select max(sl2.occurred_at)
      from public.stage_logs sl2
      where sl2.order_item_id = sl.order_item_id
        and sl2.stage_order = sl.stage_order
    )
  order by sl.stage_order desc, sl.occurred_at desc
  limit 1;

  if v_latest_finished is null then
    raise exception 'There is no completed stage to send back.' using errcode = '22023';
  end if;

  v_expected_order := (v_latest_finished->>'stage_order')::integer;

  if p_stage_order <> v_expected_order then
    raise exception 'Only the most recently completed stage can be sent back.' using errcode = '22023';
  end if;

  if trim(coalesce(p_stage_name, '')) <> trim(coalesce(v_latest_finished->>'stage_name', '')) then
    raise exception 'Production stage name does not match the latest completed stage.' using errcode = '22023';
  end if;

  insert into public.stage_logs (
    order_item_id,
    stage_order,
    stage_name,
    action,
    performed_by_user_id
  )
  values (
    v_item.id,
    v_expected_order,
    trim(v_latest_finished->>'stage_name'),
    'sent_back',
    auth.uid()
  )
  returning id into v_log_id;

  return jsonb_build_object(
    'stage_log_id', v_log_id,
    'stage_order', v_expected_order,
    'stage_name', trim(v_latest_finished->>'stage_name')
  );
end;
$$;

revoke all on function public.finish_production_stage(uuid, integer, text, text) from public;
grant execute on function public.finish_production_stage(uuid, integer, text, text) to authenticated;

revoke all on function public.send_back_production_stage(uuid, integer, text) from public;
grant execute on function public.send_back_production_stage(uuid, integer, text) to authenticated;
