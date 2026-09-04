-- Ordeli v2 foundation schema
-- Fresh-schema target for the redesigned application.
-- This file intentionally does not DROP existing objects.

create extension if not exists pgcrypto;

-- ============================================================
-- ENUMS
-- ============================================================

do $$ begin create type public.qr_status as enum ('available','assigned','revoked'); exception when duplicate_object then null; end $$;
do $$ begin create type public.order_lifecycle as enum ('active','fulfilled','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_type as enum ('downpayment','additional','balance'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_proof_status as enum ('pending_verification','confirmed','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type public.fulfillment_type as enum ('pickup_shop','pickup_location','courier'); exception when duplicate_object then null; end $$;
do $$ begin create type public.pickup_state as enum ('not_scheduled','scheduled','bring_to_event','unclaimed','rescheduled','handed_over'); exception when duplicate_object then null; end $$;
do $$ begin create type public.event_state as enum ('upcoming','ready','active','completed','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.stage_action as enum ('finished','sent_back'); exception when duplicate_object then null; end $$;
do $$ begin create type public.member_role as enum ('owner','production_member'); exception when duplicate_object then null; end $$;
do $$ begin create type public.sync_state as enum ('pending','processing','synced','error'); exception when duplicate_object then null; end $$;

-- ============================================================
-- UPDATED-AT HELPER
-- ============================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- SELLER / SHOP
-- One auth user owns one seller/shop record.
-- ============================================================

create table if not exists public.sellers (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  login_method text not null default 'email' check (login_method in ('email','google')),
  google_id text,
  shop_name text not null default '',
  shop_address text not null default '',
  shop_logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sellers_google_id_idx on public.sellers(google_id);

create trigger sellers_touch_updated_at
before update on public.sellers
for each row execute function public.touch_updated_at();

-- ============================================================
-- PRODUCTION MEMBERS
-- Auth users are still normal Supabase users; membership grants shop access.
-- ============================================================

create table if not exists public.production_members (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  section_label text,
  permissions jsonb not null default '{"view_production":true,"complete_stage":true,"upload_proof":true}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_id, user_id)
);

create index if not exists production_members_seller_idx on public.production_members(seller_id);
create trigger production_members_touch_updated_at
before update on public.production_members
for each row execute function public.touch_updated_at();

-- ============================================================
-- PRODUCTS / WORKFLOWS
-- ============================================================

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  name text not null,
  default_price numeric(12,2) not null default 0 check (default_price >= 0),
  customer_cancellable_until_stage integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_seller_idx on public.products(seller_id);

create table if not exists public.production_stages (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  stage_order integer not null check (stage_order >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, stage_order),
  unique (product_id, name)
);

create index if not exists production_stages_product_idx on public.production_stages(product_id, stage_order);

create trigger products_touch_updated_at
before update on public.products
for each row execute function public.touch_updated_at();
create trigger production_stages_touch_updated_at
before update on public.production_stages
for each row execute function public.touch_updated_at();

-- ============================================================
-- QR INVENTORY
-- ============================================================

create table if not exists public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  series_name text not null,
  series_sequence bigint not null check (series_sequence > 0),
  code text not null,
  public_token text not null unique,
  status public.qr_status not null default 'available',
  assigned_order_item_id uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (product_id, series_name, series_sequence),
  unique (seller_id, code)
);

create index if not exists qr_codes_seller_idx on public.qr_codes(seller_id, status);
create index if not exists qr_codes_product_idx on public.qr_codes(product_id, status);
create index if not exists qr_codes_token_idx on public.qr_codes(public_token);

-- ============================================================
-- CUSTOMERS / ORDERS
-- ============================================================

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customers_seller_idx on public.customers(seller_id, name);
create trigger customers_touch_updated_at
before update on public.customers
for each row execute function public.touch_updated_at();

create sequence if not exists public.order_number_seq;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  order_number bigint not null default nextval('public.order_number_seq'),
  lifecycle public.order_lifecycle not null default 'active',
  fulfillment_type public.fulfillment_type,
  pickup_state public.pickup_state not null default 'not_scheduled',
  selected_event_id uuid,
  handed_over_at timestamptz,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_seller_idx on public.orders(seller_id, created_at desc);
create index if not exists orders_customer_idx on public.orders(customer_id, created_at desc);
create index if not exists orders_event_idx on public.orders(selected_event_id, pickup_state);
create trigger orders_touch_updated_at
before update on public.orders
for each row execute function public.touch_updated_at();

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  total_price numeric(12,2) generated always as (quantity * unit_price) stored,
  workflow_snapshot jsonb not null default '[]'::jsonb,
  cancellable_until_stage integer,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists order_items_order_idx on public.order_items(order_id, created_at);
create index if not exists order_items_product_idx on public.order_items(product_id);
create trigger order_items_touch_updated_at
before update on public.order_items
for each row execute function public.touch_updated_at();

alter table public.qr_codes
  add constraint qr_codes_assigned_order_item_fk
  foreign key (assigned_order_item_id) references public.order_items(id) on delete restrict;

create unique index if not exists qr_codes_one_assignment_idx
  on public.qr_codes(assigned_order_item_id)
  where assigned_order_item_id is not null;

-- ============================================================
-- PRODUCTION HISTORY
-- ============================================================

create table if not exists public.stage_logs (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  stage_order integer not null check (stage_order >= 1),
  stage_name text not null,
  action public.stage_action not null,
  performed_by_user_id uuid references auth.users(id),
  note text,
  proof_photo_path text,
  occurred_at timestamptz not null default now(),
  client_operation_id uuid unique
);
create index if not exists stage_logs_item_idx on public.stage_logs(order_item_id, stage_order, occurred_at);

-- ============================================================
-- PAYMENTS
-- ============================================================

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  payment_type public.payment_type not null,
  proof_status public.payment_proof_status,
  proof_path text,
  proof_rejection_reason text,
  confirmed_at timestamptz,
  confirmed_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_operation_id uuid unique
);
create index if not exists payments_order_idx on public.payments(order_id, created_at);
create index if not exists payments_seller_proof_idx on public.payments(seller_id, proof_status, created_at);
create trigger payments_touch_updated_at
before update on public.payments
for each row execute function public.touch_updated_at();

-- ============================================================
-- EVENTS / PICKUP HISTORY
-- ============================================================

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  name text not null,
  location text not null,
  event_date date not null,
  start_time time not null,
  end_time time not null,
  notes text,
  state public.event_state not null default 'upcoming',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists events_seller_date_idx on public.events(seller_id, event_date, start_time);
create trigger events_touch_updated_at
before update on public.events
for each row execute function public.touch_updated_at();

alter table public.orders
  add constraint orders_selected_event_fk
  foreign key (selected_event_id) references public.events(id) on delete restrict;

create table if not exists public.pickup_history (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_event_id uuid references public.events(id),
  to_event_id uuid references public.events(id),
  action text not null check (action in ('scheduled','rescheduled','unclaimed','handed_over')),
  reason text,
  changed_by_user_id uuid references auth.users(id),
  occurred_at timestamptz not null default now(),
  client_operation_id uuid unique
);
create index if not exists pickup_history_order_idx on public.pickup_history(order_id, occurred_at);

-- ============================================================
-- REVIEWS
-- ============================================================

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  rating integer not null check (rating between 1 and 5),
  text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reviews_seller_idx on public.reviews(seller_id, created_at desc);
create trigger reviews_touch_updated_at
before update on public.reviews
for each row execute function public.touch_updated_at();

-- ============================================================
-- DEVICE / OFFLINE SYNC
-- ============================================================

create table if not exists public.seller_devices (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  device_id text not null,
  label text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (seller_id, device_id)
);

create table if not exists public.offline_qr_reservations (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  qr_code_id uuid not null unique references public.qr_codes(id) on delete restrict,
  device_id text not null,
  reserved_at timestamptz not null default now(),
  released_at timestamptz
);
create index if not exists offline_qr_reservations_device_idx on public.offline_qr_reservations(seller_id, device_id, released_at);

create table if not exists public.sync_operations (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  device_id text not null,
  operation_id uuid not null unique,
  operation_type text not null,
  payload jsonb not null,
  state public.sync_state not null default 'pending',
  result jsonb,
  last_error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz
);
create index if not exists sync_operations_seller_state_idx on public.sync_operations(seller_id, state, created_at);
create trigger sync_operations_touch_updated_at
before update on public.sync_operations
for each row execute function public.touch_updated_at();

-- ============================================================
-- HELPER VIEWS
-- These deliberately compute independent statuses rather than persisting a mega-status.
-- ============================================================

create or replace view public.order_financial_summary as
select
  o.id as order_id,
  coalesce(sum(case when p.proof_status is null or p.proof_status = 'confirmed' then p.amount else 0 end), 0)::numeric(12,2) as paid_amount,
  greatest(
    coalesce(sum(oi.total_price) filter (where oi.cancelled_at is null), 0)
    - coalesce(sum(case when p.proof_status is null or p.proof_status = 'confirmed' then p.amount else 0 end), 0),
    0
  )::numeric(12,2) as remaining_balance,
  case
    when coalesce(sum(oi.total_price) filter (where oi.cancelled_at is null), 0) = 0 then 'fully_paid'
    when coalesce(sum(case when p.proof_status is null or p.proof_status = 'confirmed' then p.amount else 0 end), 0) >= coalesce(sum(oi.total_price) filter (where oi.cancelled_at is null), 0) then 'fully_paid'
    when exists (select 1 from public.payments pp where pp.order_id = o.id and pp.proof_status = 'pending_verification') then 'pending_verification'
    when exists (select 1 from public.payments pp where pp.order_id = o.id and pp.proof_status = 'rejected') then 'rejected'
    when coalesce(sum(case when p.proof_status is null or p.proof_status = 'confirmed' then p.amount else 0 end), 0) > 0 then 'partially_paid'
    else 'unpaid'
  end as payment_status
from public.orders o
left join public.order_items oi on oi.order_id = o.id
left join public.payments p on p.order_id = o.id
group by o.id;

create or replace view public.order_production_summary as
select
  o.id as order_id,
  count(oi.id) filter (where oi.cancelled_at is null) as active_item_count,
  count(oi.id) filter (where oi.cancelled_at is null and not exists (select 1 from public.production_stages ps where ps.product_id = oi.product_id)) as no_workflow_item_count,
  count(oi.id) filter (where oi.cancelled_at is null and (
    exists (select 1 from jsonb_array_elements(oi.workflow_snapshot) s where coalesce((s->>'stage_order')::int, 0) = (select max(coalesce((x->>'stage_order')::int,0)) from jsonb_array_elements(oi.workflow_snapshot) x))
  )) as workflow_item_count
from public.orders o
left join public.order_items oi on oi.order_id = o.id
group by o.id;

-- ============================================================
-- AUTH / OWNERSHIP HELPERS
-- ============================================================

create or replace function public.current_seller_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.sellers s where s.id = auth.uid()) then auth.uid()
    when exists (select 1 from public.production_members pm where pm.user_id = auth.uid() and pm.is_active) then (
      select pm.seller_id from public.production_members pm where pm.user_id = auth.uid() and pm.is_active order by pm.created_at limit 1
    )
    else null
  end;
$$;

create or replace function public.has_seller_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.sellers s where s.id = auth.uid())
    or exists (
      select 1
      from public.production_members pm
      where pm.user_id = auth.uid()
        and pm.is_active
        and coalesce((pm.permissions ->> p_permission)::boolean, false)
    );
$$;

-- ============================================================
-- RLS
-- ============================================================

alter table public.sellers enable row level security;
alter table public.production_members enable row level security;
alter table public.products enable row level security;
alter table public.production_stages enable row level security;
alter table public.qr_codes enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.stage_logs enable row level security;
alter table public.payments enable row level security;
alter table public.events enable row level security;
alter table public.pickup_history enable row level security;
alter table public.reviews enable row level security;
alter table public.seller_devices enable row level security;
alter table public.offline_qr_reservations enable row level security;
alter table public.sync_operations enable row level security;

-- Sellers see their own shop.
drop policy if exists sellers_select_own on public.sellers;
create policy sellers_select_own on public.sellers for select using (id = auth.uid());
drop policy if exists sellers_insert_own on public.sellers;
create policy sellers_insert_own on public.sellers for insert with check (id = auth.uid());
drop policy if exists sellers_update_own on public.sellers;
create policy sellers_update_own on public.sellers for update using (id = auth.uid()) with check (id = auth.uid());

-- The same ownership pattern is used for seller-owned entities. Production members have read access only where useful.
create or replace function public.seller_scope_policy(seller_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select seller_id = public.current_seller_id(); $$;

-- Policies are intentionally explicit rather than using broad "authenticated" access.
drop policy if exists production_members_scope on public.production_members;
create policy production_members_scope on public.production_members for all using (seller_id = public.current_seller_id()) with check (seller_id = public.current_seller_id());
drop policy if exists products_scope on public.products;
create policy products_scope on public.products for all using (seller_id = public.current_seller_id()) with check (seller_id = public.current_seller_id());
drop policy if exists production_stages_scope on public.production_stages;
create policy production_stages_scope on public.production_stages for all using (product_id in (select id from public.products where seller_id = public.current_seller_id())) with check (product_id in (select id from public.products where seller_id = public.current_seller_id()));
drop policy if exists qr_codes_scope on public.qr_codes;
create policy qr_codes_scope on public.qr_codes for all using (seller_id = public.current_seller_id()) with check (seller_id = public.current_seller_id());
drop policy if exists customers_scope on public.customers;
create policy customers_scope on public.customers for all using (seller_id = public.current_seller_id()) with check (seller_id = public.current_seller_id());
drop policy if exists orders_scope on public.orders;
create policy orders_scope on public.orders for all using (seller_id = public.current_seller_id()) with check (seller_id = public.current_seller_id());
drop policy if exists order_items_scope on public.order_items;
create policy order_items_scope on public.order_items for all using (seller_id = public.current_seller_id()) with check (seller_id = public.current_seller_id());
drop policy if exists stage_logs_scope on public.stage_logs;
create policy stage_logs_scope on public.stage_logs for all using (seller_id = public.current_seller_id()) with check (seller_id = public.current_seller_id());
drop policy if exists payments_scope on public.payments;
create policy payments_scope on public.payments for all using (seller_id = public.current_seller_id()) with check (seller_id = public.current_seller_id());
drop policy if exists events_scope on public.events;
create policy events_scope on public.events for all using (seller_id = public.current_seller_id()) with check (seller_id = public.current_seller_id());
drop policy if exists pickup_history_scope on public.pickup_history;
create policy pickup_history_scope on public.pickup_history for all using (seller_id = public.current_seller_id()) with check (seller_id = public.current_seller_id());
drop policy if exists reviews_scope on public.reviews;
create policy reviews_scope on public.reviews for all using (seller_id = public.current_seller_id()) with check (seller_id = public.current_seller_id());
drop policy if exists seller_devices_scope on public.seller_devices;
create policy seller_devices_scope on public.seller_devices for all using (seller_id = public.current_seller_id()) with check (seller_id = public.current_seller_id());
drop policy if exists offline_qr_reservations_scope on public.offline_qr_reservations;
create policy offline_qr_reservations_scope on public.offline_qr_reservations for all using (seller_id = public.current_seller_id()) with check (seller_id = public.current_seller_id());
drop policy if exists sync_operations_scope on public.sync_operations;
create policy sync_operations_scope on public.sync_operations for all using (seller_id = public.current_seller_id()) with check (seller_id = public.current_seller_id());

-- ============================================================
-- CORE RPC: Generate QR pairs
-- ============================================================

create or replace function public.generate_qr_series(
  requested_product_id uuid,
  requested_series_name text,
  requested_quantity integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid := public.current_seller_id();
  v_product_name text;
  v_next bigint;
  i integer;
  v_ids uuid[] := '{}';
  v_token text;
  v_code text;
begin
  if v_seller is null then raise exception 'Unauthorized'; end if;
  if requested_quantity < 1 or requested_quantity > 5000 then raise exception 'Quantity must be between 1 and 5000'; end if;
  select name into v_product_name from public.products where id = requested_product_id and seller_id = v_seller and is_active;
  if v_product_name is null then raise exception 'Product not found'; end if;
  select coalesce(max(series_sequence),0) + 1 into v_next from public.qr_codes where product_id = requested_product_id and series_name = trim(requested_series_name);
  if trim(requested_series_name) = '' then raise exception 'Series name is required'; end if;
  for i in 0..requested_quantity-1 loop
    v_token := encode(gen_random_bytes(18), 'base64url');
    v_code := upper(regexp_replace(v_product_name, '[^A-Za-z0-9]+', '', 'g')) || '-' || lpad((v_next+i)::text, 4, '0');
    insert into public.qr_codes(seller_id, product_id, series_name, series_sequence, code, public_token)
    values(v_seller, requested_product_id, trim(requested_series_name), v_next+i, v_code, v_token)
    returning id into v_ids[array_length(v_ids,1)+1];
  end loop;
  return jsonb_build_object('count',requested_quantity,'series_name',trim(requested_series_name),'product_id',requested_product_id);
end;
$$;

-- ============================================================
-- CORE RPC: Reserve QR inventory for offline use
-- ============================================================

create or replace function public.reserve_qr_codes_for_offline(
  p_product_id uuid,
  p_series_name text,
  p_quantity integer,
  p_device_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid := public.current_seller_id();
  v_count integer;
begin
  if v_seller is null then raise exception 'Unauthorized'; end if;
  if p_quantity < 1 then raise exception 'Quantity must be at least 1'; end if;
  insert into public.seller_devices(seller_id, device_id, last_seen_at)
  values(v_seller,p_device_id,now())
  on conflict (seller_id,device_id) do update set last_seen_at=excluded.last_seen_at;
  with candidates as (
    select q.id
    from public.qr_codes q
    where q.seller_id = v_seller
      and q.product_id = p_product_id
      and q.series_name = p_series_name
      and q.status = 'available'
      and not exists (select 1 from public.offline_qr_reservations r where r.qr_code_id=q.id and r.released_at is null)
    order by q.series_sequence
    limit p_quantity
  )
  insert into public.offline_qr_reservations(seller_id, qr_code_id, device_id)
  select v_seller, id, p_device_id from candidates
  on conflict (qr_code_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.release_qr_reservations_for_offline(
  p_product_id uuid,
  p_series_name text,
  p_device_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_seller uuid := public.current_seller_id(); v_count integer;
begin
  update public.offline_qr_reservations r
  set released_at=now()
  where r.seller_id=v_seller and r.device_id=p_device_id and r.released_at is null
    and r.qr_code_id in (select q.id from public.qr_codes q where q.product_id=p_product_id and q.series_name=p_series_name);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ============================================================
-- CORE RPC: Create an order item from one scanned QR.
-- ============================================================

create or replace function public.add_order_item_from_qr(
  p_order_id uuid,
  p_qr_public_token text,
  p_quantity integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid := public.current_seller_id();
  v_qr public.qr_codes%rowtype;
  v_order public.orders%rowtype;
  v_product public.products%rowtype;
  v_item uuid;
  v_snapshot jsonb;
begin
  if v_seller is null then raise exception 'Unauthorized'; end if;
  select * into v_order from public.orders where id=p_order_id and seller_id=v_seller;
  if not found then raise exception 'Order not found'; end if;
  if p_quantity < 1 then raise exception 'Quantity must be at least 1'; end if;
  select * into v_qr from public.qr_codes where public_token=p_qr_public_token and seller_id=v_seller for update;
  if not found then raise exception 'QR code not found'; end if;
  if v_qr.status <> 'available' then raise exception 'QR code is already assigned or revoked'; end if;
  select * into v_product from public.products where id=v_qr.product_id and seller_id=v_seller and is_active;
  if not found then raise exception 'Product not available'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('stage_order',ps.stage_order,'name',ps.name) order by ps.stage_order),'[]'::jsonb)
    into v_snapshot from public.production_stages ps where ps.product_id=v_product.id;
  insert into public.order_items(seller_id,order_id,product_id,product_name,quantity,unit_price,workflow_snapshot,cancellable_until_stage)
  values(v_seller,p_order_id,v_product.id,v_product.name,p_quantity,v_product.default_price,v_snapshot,v_product.customer_cancellable_until_stage)
  returning id into v_item;
  update public.qr_codes set status='assigned',assigned_order_item_id=v_item where id=v_qr.id;
  return jsonb_build_object('order_item_id',v_item,'order_id',p_order_id,'product_id',v_product.id,'product_name',v_product.name,'unit_price',v_product.default_price,'workflow_snapshot',v_snapshot);
end;
$$;

-- ============================================================
-- CORE RPC: Offline-safe initial order creation
-- ============================================================

create or replace function public.sync_offline_order(
  p_client_order_id uuid,
  p_device_id text,
  p_qr_public_token text,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_quantity integer,
  p_downpayment numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid := public.current_seller_id();
  v_existing jsonb;
  v_customer uuid;
  v_order uuid;
  v_item jsonb;
begin
  if v_seller is null then raise exception 'Unauthorized'; end if;
  select result into v_existing from public.sync_operations where operation_id=p_client_order_id and seller_id=v_seller and state='synced';
  if v_existing is not null then return v_existing; end if;
  if p_customer_id is not null then
    select id into v_customer from public.customers where id=p_customer_id and seller_id=v_seller;
  end if;
  if v_customer is null then
    if coalesce(trim(p_customer_name),'')='' then raise exception 'Customer name is required'; end if;
    insert into public.customers(seller_id,name,phone) values(v_seller,trim(p_customer_name),nullif(trim(p_customer_phone),'')) returning id into v_customer;
  end if;
  insert into public.orders(seller_id,customer_id) values(v_seller,v_customer) returning id into v_order;
  v_item := public.add_order_item_from_qr(v_order,p_qr_public_token,p_quantity);
  if coalesce(p_downpayment,0) > 0 then
    insert into public.payments(seller_id,order_id,amount,payment_type,client_operation_id)
    values(v_seller,v_order,p_downpayment,'downpayment',p_client_order_id);
  end if;
  insert into public.sync_operations(seller_id,device_id,operation_id,operation_type,payload,state,result,synced_at)
  values(v_seller,p_device_id,p_client_order_id,'create_order',jsonb_build_object('qr_token',p_qr_public_token),'synced',jsonb_build_object('order_id',v_order,'order_number',(select order_number from public.orders where id=v_order)),now())
  on conflict (operation_id) do update set state='synced',result=excluded.result,synced_at=now();
  return (select result from public.sync_operations where operation_id=p_client_order_id);
end;
$$;

-- ============================================================
-- CUSTOMER TRACKING TOKEN ACCESS
-- Public tracking is intentionally exposed only through an RPC that returns
-- customer-safe fields. No customer role receives table-wide SELECT access.
-- ============================================================

create or replace function public.get_customer_tracking(p_public_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr public.qr_codes%rowtype;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_customer public.customers%rowtype;
  v_seller public.sellers%rowtype;
  v_stages jsonb;
  v_items jsonb;
  v_payment jsonb;
begin
  select * into v_qr from public.qr_codes where public_token=p_public_token and status='assigned';
  if not found then return null; end if;
  select * into v_item from public.order_items where id=v_qr.assigned_order_item_id;
  select * into v_order from public.orders where id=v_item.order_id;
  select * into v_customer from public.customers where id=v_order.customer_id;
  select * into v_seller from public.sellers where id=v_order.seller_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'stage_order',s.stage_order,
    'name',s.name,
    'status',case
      when exists(select 1 from public.stage_logs l where l.order_item_id=v_item.id and l.stage_order=s.stage_order and l.action='finished'
                  and not exists(select 1 from public.stage_logs b where b.order_item_id=v_item.id and b.stage_order=s.stage_order and b.action='sent_back' and b.occurred_at > (select max(f.occurred_at) from public.stage_logs f where f.order_item_id=v_item.id and f.stage_order=s.stage_order and f.action='finished')))
        then 'finished'
      when s.stage_order = coalesce((select max(l.stage_order) from public.stage_logs l where l.order_item_id=v_item.id and l.action='finished'),0)+1 then 'in_progress'
      else 'upcoming'
    end,
    'latest_proof_path',null
  ) order by s.stage_order),'[]'::jsonb)
  into v_stages
  from jsonb_to_recordset(v_item.workflow_snapshot) as s(stage_order integer,name text);

  select coalesce(jsonb_agg(jsonb_build_object('product_name',oi.product_name,'quantity',oi.quantity,'production_status',
    case when oi.cancelled_at is not null then 'cancelled'
         when coalesce((select max(sl.stage_order) from public.stage_logs sl where sl.order_item_id=oi.id and sl.action='finished'),0) >= coalesce((select max((x->>'stage_order')::int) from jsonb_array_elements(oi.workflow_snapshot) x),0) then 'completed'
         else 'in_progress' end,
    'cancelled',oi.cancelled_at is not null) order by oi.created_at),'[]'::jsonb)
  into v_items from public.order_items oi where oi.order_id=v_order.id;

  select jsonb_build_object(
    'total',coalesce(sum(oi.total_price) filter (where oi.cancelled_at is null),0),
    'paid',coalesce(sum(case when p.proof_status is null or p.proof_status='confirmed' then p.amount else 0 end),0),
    'remaining',greatest(coalesce(sum(oi.total_price) filter (where oi.cancelled_at is null),0)-coalesce(sum(case when p.proof_status is null or p.proof_status='confirmed' then p.amount else 0 end),0),0),
    'status',case
      when coalesce(sum(oi.total_price) filter (where oi.cancelled_at is null),0)=0 then 'fully_paid'
      when coalesce(sum(case when p.proof_status is null or p.proof_status='confirmed' then p.amount else 0 end),0) >= coalesce(sum(oi.total_price) filter (where oi.cancelled_at is null),0) then 'fully_paid'
      when exists(select 1 from public.payments pp where pp.order_id=v_order.id and pp.proof_status='pending_verification') then 'pending_verification'
      when exists(select 1 from public.payments pp where pp.order_id=v_order.id and pp.proof_status='rejected') then 'rejected'
      when coalesce(sum(case when p.proof_status is null or p.proof_status='confirmed' then p.amount else 0 end),0)>0 then 'partially_paid'
      else 'unpaid' end
  ) into v_payment
  from public.order_items oi left join public.payments p on p.order_id=v_order.id where oi.order_id=v_order.id;

  return jsonb_build_object(
    'shop',jsonb_build_object('name',v_seller.shop_name,'address',v_seller.shop_address,'logo_path',v_seller.shop_logo_path),
    'order',jsonb_build_object('id',null,'order_number',v_order.order_number,'created_at',v_order.created_at,'fulfillment_type',v_order.fulfillment_type,'pickup_state',v_order.pickup_state,'cancelled_at',v_order.cancelled_at),
    'item',jsonb_build_object('product_name',v_item.product_name,'quantity',v_item.quantity,'production_completed',coalesce((select max((x->>'stage_order')::int) from jsonb_array_elements(v_item.workflow_snapshot) x),0) <= coalesce((select max(l.stage_order) from public.stage_logs l where l.order_item_id=v_item.id and l.action='finished'),0),'production_stages',v_stages,'cancelled_at',v_item.cancelled_at),
    'payment',v_payment,
    'order_items',v_items
  );
end;
$$;

-- ============================================================
-- STORAGE BUCKETS
-- The application should make production proof delivery through signed URLs.
-- Payment proofs stay private.
-- ============================================================

insert into storage.buckets(id,name,public)
values
  ('production-proofs','production-proofs',false),
  ('payment-proofs','payment-proofs',false),
  ('shop-assets','shop-assets',false)
on conflict (id) do update set public=excluded.public;

-- ============================================================
-- COMMENTS: business rules that must remain invariant in app code/RPCs
-- ============================================================

comment on table public.order_items is 'One QR and one shared production lifecycle per order item; quantity is never split into independent production units.';
comment on column public.order_items.workflow_snapshot is 'Immutable copy of product workflow at order-item creation time. Product edits must not mutate historical order workflows.';
comment on table public.stage_logs is 'Append-only production history. There is no separate manually-set Completed state.';
comment on column public.orders.fulfillment_type is 'Available only after every active order item is production-complete and the order is fully paid.';
comment on table public.sync_operations is 'Durable idempotency ledger for offline writes and safe retry behavior.';
