begin;

-- Central helper for seller-side SMS drafts.
-- Drafts are only created when the customer has a phone number because the
-- customer specification treats SMS as an optional, seller-only action.
create or replace function public.queue_sms_update(
  p_seller_id uuid,
  p_order_id uuid,
  p_message text,
  p_triggered_by_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft_id uuid;
  v_phone text;
begin
  select nullif(trim(c.phone), '')
    into v_phone
  from public.orders o
  join public.customers c on c.id = o.customer_id
  where o.id = p_order_id
    and o.seller_id = p_seller_id
    and o.cancelled_at is null;

  if v_phone is null then
    return null;
  end if;

  insert into public.sms_update_drafts(
    seller_id,
    order_id,
    triggered_by_user_id,
    message_text,
    status,
    created_at
  ) values (
    p_seller_id,
    p_order_id,
    p_triggered_by_user_id,
    trim(p_message),
    'ready',
    now()
  )
  returning id into v_draft_id;

  return v_draft_id;
end;
$$;


-- Order-created / added-item notification.
-- order_items are inserted after the order itself, so this is the first safe
-- point where the tracking QR/token and product are available.
create or replace function public.trg_order_item_sms_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_customer_name text;
  v_token text;
  v_item_count integer;
  v_message text;
  v_actor uuid := auth.uid();
begin
  select * into v_order
  from public.orders
  where id = new.order_id
    and cancelled_at is null;
  if not found then
    return new;
  end if;

  select name into v_customer_name
  from public.customers
  where id = v_order.customer_id;

  select count(*) into v_item_count
  from public.order_items
  where order_id = new.order_id;

  select q.public_token into v_token
  from public.qr_codes q
  where q.id = new.qr_code_id
  limit 1;

  if v_item_count = 1 then
    v_message := format(
      'Hi %s, your order #%s has been created. Please check your order here: %s',
      coalesce(v_customer_name, 'there'),
      v_order.order_number,
      case when v_token is null then '' else '/t/' || v_token end
    );
  else
    v_message := format(
      'Hi %s, your order #%s has been updated with %s × %s. Please check your order here: %s',
      coalesce(v_customer_name, 'there'),
      v_order.order_number,
      new.product_name,
      new.quantity,
      case when v_token is null then '' else '/t/' || v_token end
    );
  end if;

  perform public.queue_sms_update(v_order.seller_id, v_order.id, v_message, v_actor);
  return new;
end;
$$;

drop trigger if exists trg_order_item_sms_update on public.order_items;
create trigger trg_order_item_sms_update
after insert on public.order_items
for each row execute function public.trg_order_item_sms_update();

-- Seller-direct production completion notification.
-- Production members already create their own drafts inside their restricted
-- RPC, so the trigger deliberately skips authenticated production members.
create or replace function public.trg_stage_log_sms_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_customer_name text;
  v_message text;
  v_actor uuid := auth.uid();
  v_token text;
begin
  if new.action <> 'finished' or v_actor is null then
    return new;
  end if;

  if exists (
    select 1
    from public.production_members pm
    where pm.auth_user_id = v_actor
      and pm.is_active = true
  ) then
    return new;
  end if;

  select * into v_item
  from public.order_items
  where id = new.order_item_id
    and cancelled_at is null;
  if not found then
    return new;
  end if;

  select * into v_order
  from public.orders
  where id = v_item.order_id
    and cancelled_at is null;
  if not found then
    return new;
  end if;

  select name into v_customer_name
  from public.customers
  where id = v_order.customer_id;

  select q.public_token into v_token
  from public.qr_codes q
  where q.order_item_id = v_item.id
  limit 1;

  v_message := format(
    'Hi %s, your %s production stage "%s" is finished. Please check your order here: %s',
    coalesce(v_customer_name, 'there'),
    v_item.product_name,
    new.stage_name,
    case when v_token is null then '' else '/t/' || v_token end
  );

  perform public.queue_sms_update(v_order.seller_id, v_order.id, v_message, v_actor);
  return new;
end;
$$;

drop trigger if exists trg_stage_log_sms_update on public.stage_logs;
create trigger trg_stage_log_sms_update
after insert on public.stage_logs
for each row execute function public.trg_stage_log_sms_update();

-- Payment-confirmed notification. This covers both a seller-created payment
-- record (cash/direct payment) and a customer proof that the seller confirms.
create or replace function public.trg_payment_sms_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_customer_name text;
  v_message text;
  v_actor uuid := auth.uid();
  v_old_status text := case when tg_op = 'UPDATE' then old.proof_status else null end;
  v_new_status text := new.proof_status;
begin
  if v_actor is null then
    return new;
  end if;

  if not (
    (tg_op = 'INSERT' and (v_new_status is null or v_new_status = 'confirmed'))
    or
    (tg_op = 'UPDATE' and v_new_status = 'confirmed' and v_old_status is distinct from 'confirmed')
  ) then
    return new;
  end if;

  select * into v_order
  from public.orders
  where id = new.order_id
    and cancelled_at is null;
  if not found then
    return new;
  end if;

  if v_order.seller_id <> v_actor then
    return new;
  end if;

  select name into v_customer_name
  from public.customers
  where id = v_order.customer_id;

  v_message := format(
    'Hi %s, your payment of ₱%s for order #%s has been confirmed. Please check your order for the latest update.',
    coalesce(v_customer_name, 'there'),
    to_char(coalesce(new.amount, 0), 'FM999999990.00'),
    v_order.order_number
  );

  perform public.queue_sms_update(v_order.seller_id, v_order.id, v_message, v_actor);
  return new;
end;
$$;

drop trigger if exists trg_payment_sms_update on public.payments;
create trigger trg_payment_sms_update
after insert or update of proof_status on public.payments
for each row execute function public.trg_payment_sms_update();

-- Pickup/event changes initiated by a seller. This covers both the seller's
-- event-reschedule RPC and the seller marking an order unclaimed.
create or replace function public.trg_order_pickup_sms_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_name text;
  v_event_name text;
  v_event_date date;
  v_message text;
  v_actor uuid := auth.uid();
begin
  if v_actor is null or new.seller_id <> v_actor then
    return new;
  end if;

  if new.event_id is distinct from old.event_id and new.event_id is not null then
    select name, event_date into v_event_name, v_event_date
    from public.events
    where id = new.event_id;

    select name into v_customer_name
    from public.customers
    where id = new.customer_id;

    v_message := format(
      'Hi %s, your pickup schedule for order #%s has changed to %s on %s. Please check your order here: %s',
      coalesce(v_customer_name, 'there'),
      new.order_number,
      coalesce(v_event_name, 'the new pickup event'),
      to_char(v_event_date, 'FMMonth DD, YYYY'),
      coalesce(
        '/t/' || (
          select q.public_token
          from public.qr_codes q
          join public.order_items oi on oi.id = q.order_item_id
          where oi.order_id = new.id
          order by oi.created_at
          limit 1
        ),
        ''
      )
    );

    perform public.queue_sms_update(new.seller_id, new.id, v_message, v_actor);
  elsif new.pickup_status = 'unclaimed' and old.pickup_status is distinct from 'unclaimed' then
    select name into v_customer_name
    from public.customers
    where id = new.customer_id;

    v_message := format(
      'Hi %s, your pickup for order #%s was not claimed at the scheduled event. Please check your order for the next available pickup options.',
      coalesce(v_customer_name, 'there'),
      new.order_number
    );

    perform public.queue_sms_update(new.seller_id, new.id, v_message, v_actor);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_pickup_sms_update on public.orders;
create trigger trg_order_pickup_sms_update
after update of event_id, pickup_status on public.orders
for each row execute function public.trg_order_pickup_sms_update();

-- Editing an event's date/time should also generate seller-facing SMS drafts
-- for assigned active orders. The existing event-change log continues to be
-- handled by the application's normal event-edit flow.
create or replace function public.trg_event_schedule_sms_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_message text;
  v_customer_name text;
  v_order record;
  v_old_schedule text;
  v_new_schedule text;
  v_token text;
begin
  if v_actor is null or new.seller_id <> v_actor then
    return new;
  end if;

  if old.event_date is not distinct from new.event_date
     and old.start_time is not distinct from new.start_time
     and old.end_time is not distinct from new.end_time then
    return new;
  end if;

  v_old_schedule := to_char(old.event_date, 'FMMonth DD, YYYY')
    || case when old.start_time is null then '' else ' ' || to_char(old.start_time, 'HH24:MI') end;
  v_new_schedule := to_char(new.event_date, 'FMMonth DD, YYYY')
    || case when new.start_time is null then '' else ' ' || to_char(new.start_time, 'HH24:MI') end;

  for v_order in
    select o.*
    from public.orders o
    where o.seller_id = new.seller_id
      and o.event_id = new.id
      and o.cancelled_at is null
      and o.handed_over_at is null
  loop
    select c.name into v_customer_name
    from public.customers c
    where c.id = v_order.customer_id;

    select q.public_token into v_token
    from public.qr_codes q
    join public.order_items oi on oi.id = q.order_item_id
    where oi.order_id = v_order.id
    order by oi.created_at
    limit 1;

    v_message := format(
      'Hi %s, your pickup schedule for order #%s has changed from %s to %s. Please check your order here: %s',
      coalesce(v_customer_name, 'there'),
      v_order.order_number,
      v_old_schedule,
      v_new_schedule,
      case when v_token is null then '' else '/t/' || v_token end
    );

    perform public.queue_sms_update(new.seller_id, v_order.id, v_message, v_actor);
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_event_schedule_sms_update on public.events;
create trigger trg_event_schedule_sms_update
after update of event_date, start_time, end_time on public.events
for each row execute function public.trg_event_schedule_sms_update();

notify pgrst, 'reload schema';
commit;
