
-- ============================================================
-- ORDELI DATABASE SCHEMA BACKUP
-- Generated from the live Supabase project on 2026-09-13
--
-- Scope:
--   * Ordeli application tables
--   * constraints / foreign keys
--   * useful indexes
--   * RLS enablement and application RLS policies
--   * application triggers + trigger helper functions
--   * financial summary view
--   * Supabase Storage bucket configuration + relevant policies
--
-- Intentionally NOT included:
--   * Supabase-managed auth.* internals
--   * Supabase-managed storage.* internals
--   * existing customer/order/payment data
--   * legacy RPCs that reference tables which no longer exist
--
-- Before restoring:
--   1. Use a Supabase project (Auth + Storage enabled).
--   2. Run this script as a database administrator / SQL editor.
--   3. Enable the required Auth providers separately in Auth settings.
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Helper functions used by application triggers / indexes
-- ------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.qr_product_prefix(requested_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare cleaned text;
begin
  cleaned := upper(regexp_replace(coalesce(requested_name,''),'[^A-Za-z0-9]+','-','g'));
  cleaned := trim(both '-' from cleaned);
  cleaned := left(cleaned,12);
  if cleaned='' then cleaned:='QR'; end if;
  return cleaned;
end;
$$;

-- ------------------------------------------------------------
-- Base tables
-- ------------------------------------------------------------

create table if not exists public.sellers (
  id uuid not null,
  email text null,
  login_method text not null default 'email',
  google_id text null,
  shop_name text null,
  shop_address text null,
  shop_logo_path text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sellers_pkey primary key (id),
  constraint sellers_id_fkey foreign key (id) references auth.users(id) on delete cascade,
  constraint sellers_login_method_check check (login_method = any (array['email'::text,'google'::text]))
);

create table if not exists public.customers (
  id uuid not null default gen_random_uuid(),
  seller_id uuid not null,
  name text not null,
  phone text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_pkey primary key (id),
  constraint customers_name_check check (length(trim(name)) > 0),
  constraint customers_seller_id_fkey foreign key (seller_id) references public.sellers(id) on delete cascade
);

create table if not exists public.products (
  id uuid not null default gen_random_uuid(),
  seller_id uuid not null,
  name text not null,
  default_price numeric(12,2) not null default 0,
  customer_cancellable_until_stage integer null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_pkey primary key (id),
  constraint products_name_check check (length(trim(name)) > 0),
  constraint products_default_price_check check (default_price >= 0),
  constraint products_customer_cancellable_until_stage_check
    check (customer_cancellable_until_stage is null or customer_cancellable_until_stage > 0),
  constraint products_seller_id_fkey foreign key (seller_id) references public.sellers(id) on delete cascade
);

create table if not exists public.production_stages (
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  name text not null,
  stage_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_stages_pkey primary key (id),
  constraint production_stages_product_id_stage_order_key unique (product_id, stage_order),
  constraint production_stages_name_check check (length(trim(name)) > 0),
  constraint production_stages_stage_order_check check (stage_order > 0),
  constraint production_stages_product_id_fkey foreign key (product_id)
    references public.products(id) on delete cascade
);

create table if not exists public.events (
  id uuid not null default gen_random_uuid(),
  seller_id uuid not null,
  name text not null,
  location text not null,
  event_date date not null,
  start_time time without time zone null,
  end_time time without time zone null,
  notes text null,
  status text not null default 'upcoming',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_pkey primary key (id),
  constraint events_seller_id_fkey foreign key (seller_id) references public.sellers(id) on delete cascade,
  constraint events_name_check check (length(trim(name)) > 0),
  constraint events_location_check check (length(trim(location)) > 0),
  constraint events_check check (end_time is null or start_time is null or end_time > start_time),
  constraint events_status_check check (
    status = any (array['upcoming'::text,'ready'::text,'active'::text,'completed'::text,'cancelled'::text])
  )
);

create table if not exists public.customers__placeholder (
  id bigint primary key
);
drop table if exists public.customers__placeholder;

create table if not exists public.orders (
  id uuid not null default gen_random_uuid(),
  seller_id uuid not null,
  customer_id uuid not null,
  order_number bigint generated always as identity not null,
  fulfillment_type text not null default 'not_selected',
  event_id uuid null,
  pickup_status text not null default 'not_scheduled',
  handed_over_at timestamptz null,
  cancelled_at timestamptz null,
  cancel_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_pkey primary key (id),
  constraint orders_customer_id_fkey foreign key (customer_id)
    references public.customers(id) on delete restrict,
  constraint orders_event_id_fkey foreign key (event_id)
    references public.events(id) on delete restrict,
  constraint orders_seller_id_fkey foreign key (seller_id)
    references public.sellers(id) on delete cascade,
  constraint orders_fulfillment_type_check check (
    fulfillment_type = any (array['not_selected'::text,'shop'::text,'location'::text,'courier'::text])
  ),
  constraint orders_pickup_status_check check (
    pickup_status = any (array[
      'not_scheduled'::text,'scheduled'::text,'bring_to_event'::text,
      'unclaimed'::text,'rescheduled'::text,'handed_over'::text
    ])
  )
);

-- Circular relationship between order_items and qr_codes:
-- create the columns first, then add the foreign keys below.
create table if not exists public.order_items (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  seller_id uuid not null,
  product_id uuid not null,
  qr_code_id uuid null,
  product_name text not null,
  quantity integer not null,
  unit_price numeric(12,2) not null,
  total_price numeric(12,2) not null,
  workflow_snapshot jsonb not null default '[]'::jsonb,
  cancellable_until_stage integer null,
  cancelled_at timestamptz null,
  cancel_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_items_pkey primary key (id),
  constraint order_items_product_name_check check (length(trim(product_name)) > 0),
  constraint order_items_quantity_check check (quantity > 0),
  constraint order_items_unit_price_check check (unit_price >= 0),
  constraint order_items_total_price_check check (total_price >= 0),
  constraint order_items_workflow_snapshot_check check (jsonb_typeof(workflow_snapshot) = 'array'),
  constraint order_items_cancellable_until_stage_check
    check (cancellable_until_stage is null or cancellable_until_stage > 0)
);

create table if not exists public.qr_codes (
  id uuid not null default gen_random_uuid(),
  seller_id uuid not null,
  product_id uuid not null,
  code text not null,
  public_token text not null,
  status text not null default 'available',
  order_item_id uuid null,
  assigned_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  series_name text null,
  series_sequence integer null,
  constraint qr_codes_pkey primary key (id),
  constraint qr_codes_code_key unique (code),
  constraint qr_codes_public_token_key unique (public_token),
  constraint qr_codes_status_check check (
    status = any (array['available'::text,'assigned'::text,'revoked'::text])
  )
);

alter table public.order_items
  add constraint order_items_order_id_fkey foreign key (order_id)
  references public.orders(id) on delete cascade
  not valid;
alter table public.order_items
  validate constraint order_items_order_id_fkey;

alter table public.order_items
  add constraint order_items_seller_id_fkey foreign key (seller_id)
  references public.sellers(id) on delete cascade
  not valid;
alter table public.order_items
  validate constraint order_items_seller_id_fkey;

alter table public.order_items
  add constraint order_items_product_id_fkey foreign key (product_id)
  references public.products(id) on delete restrict
  not valid;
alter table public.order_items
  validate constraint order_items_product_id_fkey;

alter table public.order_items
  add constraint order_items_qr_code_id_fkey foreign key (qr_code_id)
  references public.qr_codes(id) on delete restrict
  not valid;
alter table public.order_items
  validate constraint order_items_qr_code_id_fkey;

alter table public.qr_codes
  add constraint qr_codes_seller_id_fkey foreign key (seller_id)
  references public.sellers(id) on delete cascade
  not valid;
alter table public.qr_codes
  validate constraint qr_codes_seller_id_fkey;

alter table public.qr_codes
  add constraint qr_codes_product_id_fkey foreign key (product_id)
  references public.products(id) on delete restrict
  not valid;
alter table public.qr_codes
  validate constraint qr_codes_product_id_fkey;

alter table public.qr_codes
  add constraint qr_codes_order_item_fk foreign key (order_item_id)
  references public.order_items(id) on delete restrict
  not valid;
alter table public.qr_codes
  validate constraint qr_codes_order_item_fk;

create table if not exists public.payments (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  seller_id uuid not null,
  amount numeric(12,2) not null,
  payment_type text not null,
  proof_status text null,
  proof_path text null,
  rejection_reason text null,
  confirmed_by_user_id uuid null,
  confirmed_at timestamptz null,
  created_at timestamptz not null default now(),
  payment_method text null,
  constraint payments_pkey primary key (id),
  constraint payments_order_id_fkey foreign key (order_id) references public.orders(id) on delete cascade,
  constraint payments_seller_id_fkey foreign key (seller_id) references public.sellers(id) on delete cascade,
  constraint payments_confirmed_by_user_id_fkey foreign key (confirmed_by_user_id)
    references auth.users(id) on delete set null,
  constraint payments_amount_check check (amount > 0),
  constraint payments_payment_type_check check (
    payment_type = any (array['downpayment'::text,'additional'::text,'balance'::text])
  ),
  constraint payments_proof_status_check check (
    proof_status is null or proof_status = any (array[
      'pending_verification'::text,'confirmed'::text,'rejected'::text
    ])
  ),
  constraint payments_payment_method_check check (
    payment_method is null or payment_method = any (array[
      'cash'::text,'bank_transfer'::text,'digital_wallet'::text
    ])
  )
);

create table if not exists public.stage_logs (
  id uuid not null default gen_random_uuid(),
  order_item_id uuid not null,
  stage_order integer not null,
  stage_name text not null,
  action text not null,
  performed_by_user_id uuid null,
  note text null,
  proof_photo_path text null,
  occurred_at timestamptz not null default now(),
  constraint stage_logs_pkey primary key (id),
  constraint stage_logs_order_item_id_fkey foreign key (order_item_id)
    references public.order_items(id) on delete cascade,
  constraint stage_logs_performed_by_user_id_fkey foreign key (performed_by_user_id)
    references auth.users(id) on delete set null,
  constraint stage_logs_action_check check (
    action = any (array['finished'::text,'sent_back'::text])
  ),
  constraint stage_logs_stage_name_check check (length(trim(stage_name)) > 0),
  constraint stage_logs_stage_order_check check (stage_order > 0)
);

create table if not exists public.production_members (
  id uuid not null default gen_random_uuid(),
  seller_id uuid not null,
  auth_user_id uuid null,
  name text not null,
  section_label text null,
  role text not null default 'production_member',
  can_view_production boolean not null default true,
  can_scan_qr boolean not null default true,
  can_finish_stage boolean not null default true,
  can_upload_proof boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email text null,
  invite_token text null,
  invite_status text not null default 'pending',
  constraint production_members_pkey primary key (id),
  constraint production_members_auth_user_id_key unique (auth_user_id),
  constraint production_members_auth_user_id_fkey foreign key (auth_user_id)
    references auth.users(id) on delete set null,
  constraint production_members_seller_id_fkey foreign key (seller_id)
    references public.sellers(id) on delete cascade,
  constraint production_members_role_check check (role = 'production_member')
);

create table if not exists public.offline_order_syncs (
  seller_id uuid not null,
  device_id text not null,
  client_order_id text not null,
  order_id uuid not null,
  synced_at timestamptz not null default now(),
  constraint offline_order_syncs_pkey primary key (seller_id, client_order_id),
  constraint offline_order_syncs_order_id_fkey foreign key (order_id)
    references public.orders(id) on delete cascade,
  constraint offline_order_syncs_seller_id_fkey foreign key (seller_id)
    references public.sellers(id) on delete cascade
);

create table if not exists public.offline_qr_reservations (
  qr_code_id uuid not null,
  seller_id uuid not null,
  device_id text not null,
  reserved_at timestamptz not null default now(),
  constraint offline_qr_reservations_pkey primary key (qr_code_id),
  constraint offline_qr_reservations_qr_code_id_fkey foreign key (qr_code_id)
    references public.qr_codes(id) on delete cascade,
  constraint offline_qr_reservations_seller_id_fkey foreign key (seller_id)
    references public.sellers(id) on delete cascade
);

create table if not exists public.order_event_history (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  old_event_id uuid null,
  new_event_id uuid null,
  reason text null,
  changed_by_user_id uuid null,
  occurred_at timestamptz not null default now(),
  constraint order_event_history_pkey primary key (id),
  constraint order_event_history_changed_by_user_id_fkey foreign key (changed_by_user_id)
    references auth.users(id) on delete set null,
  constraint order_event_history_new_event_id_fkey foreign key (new_event_id)
    references public.events(id) on delete set null,
  constraint order_event_history_old_event_id_fkey foreign key (old_event_id)
    references public.events(id) on delete set null,
  constraint order_event_history_order_id_fkey foreign key (order_id)
    references public.orders(id) on delete cascade
);

create table if not exists public.event_change_logs (
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  original_event_date date null,
  original_start_time time without time zone null,
  original_end_time time without time zone null,
  new_event_date date null,
  new_start_time time without time zone null,
  new_end_time time without time zone null,
  reason text null,
  changed_by_user_id uuid null,
  occurred_at timestamptz not null default now(),
  constraint event_change_logs_pkey primary key (id),
  constraint event_change_logs_changed_by_user_id_fkey foreign key (changed_by_user_id)
    references auth.users(id) on delete set null,
  constraint event_change_logs_event_id_fkey foreign key (event_id)
    references public.events(id) on delete cascade
);

create table if not exists public.reviews (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  seller_id uuid not null,
  rating integer not null,
  review_text text null,
  created_at timestamptz not null default now(),
  constraint reviews_pkey primary key (id),
  constraint reviews_order_id_key unique (order_id),
  constraint reviews_order_id_fkey foreign key (order_id) references public.orders(id) on delete cascade,
  constraint reviews_seller_id_fkey foreign key (seller_id) references public.sellers(id) on delete cascade,
  constraint reviews_rating_check check (rating >= 1 and rating <= 5)
);

create table if not exists public.sms_update_drafts (
  id uuid not null default gen_random_uuid(),
  seller_id uuid not null,
  order_id uuid not null,
  triggered_by_user_id uuid null,
  message_text text not null,
  status text not null default 'ready',
  created_at timestamptz not null default now(),
  sent_marked_at timestamptz null,
  constraint sms_update_drafts_pkey primary key (id),
  constraint sms_update_drafts_order_id_fkey foreign key (order_id)
    references public.orders(id) on delete cascade,
  constraint sms_update_drafts_seller_id_fkey foreign key (seller_id)
    references public.sellers(id) on delete cascade,
  constraint sms_update_drafts_triggered_by_user_id_fkey foreign key (triggered_by_user_id)
    references auth.users(id) on delete set null,
  constraint sms_update_drafts_status_check check (
    status = any (array['ready'::text,'dismissed'::text,'sent_marked'::text])
  )
);

-- ------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------

create unique index if not exists sellers_google_id_unique
  on public.sellers (google_id) where google_id is not null;

create index if not exists customers_seller_id_idx on public.customers (seller_id);
create index if not exists customers_seller_phone_idx on public.customers (seller_id, phone);
create index if not exists idx_customers_seller_name on public.customers (seller_id, name);

create index if not exists products_seller_id_idx on public.products (seller_id);
create index if not exists idx_products_seller_id_active on public.products (seller_id, is_active);

create index if not exists production_stages_product_id_idx on public.production_stages (product_id);
create index if not exists idx_production_stages_product_order on public.production_stages (product_id, stage_order);

create index if not exists events_seller_id_idx on public.events (seller_id);
create index if not exists events_seller_date_idx on public.events (seller_id, event_date);
create index if not exists idx_events_seller_date on public.events (seller_id, event_date, start_time);

create unique index if not exists orders_seller_order_number_unique on public.orders (seller_id, order_number);
create index if not exists orders_seller_id_idx on public.orders (seller_id);
create index if not exists orders_customer_id_idx on public.orders (customer_id);
create index if not exists orders_event_id_idx on public.orders (event_id);
create index if not exists orders_created_at_idx on public.orders (created_at);
create index if not exists idx_orders_seller_created on public.orders (seller_id, created_at desc);
create index if not exists idx_orders_seller_event on public.orders (seller_id, event_id) where event_id is not null;

create index if not exists idx_order_items_order on public.order_items (order_id);
create index if not exists idx_order_items_seller on public.order_items (seller_id);
create index if not exists order_items_product_id_idx on public.order_items (product_id);
create unique index if not exists order_items_qr_unique
  on public.order_items (qr_code_id) where qr_code_id is not null;

create index if not exists qr_codes_seller_id_idx on public.qr_codes (seller_id);
create index if not exists qr_codes_product_id_idx on public.qr_codes (product_id);
create index if not exists qr_codes_status_idx on public.qr_codes (status);
create index if not exists qr_codes_order_item_id_idx on public.qr_codes (order_item_id);
create unique index if not exists qr_codes_assigned_order_item_unique
  on public.qr_codes (order_item_id) where order_item_id is not null and status='assigned';
create unique index if not exists qr_codes_product_sequence_unique
  on public.qr_codes (product_id, series_sequence) where series_sequence is not null;
create index if not exists qr_codes_series_idx on public.qr_codes (seller_id, product_id, series_name);
create index if not exists idx_qr_codes_seller_status on public.qr_codes (seller_id, status);
create index if not exists idx_qr_codes_product_status on public.qr_codes (product_id, status);
create index if not exists idx_qr_codes_order_item_id on public.qr_codes (order_item_id) where order_item_id is not null;

create index if not exists payments_order_id_idx on public.payments (order_id);
create index if not exists payments_seller_id_idx on public.payments (seller_id);
create index if not exists payments_proof_status_idx on public.payments (proof_status);
create index if not exists idx_payments_order_created on public.payments (order_id, created_at);
create index if not exists payments_payment_method_idx on public.payments (payment_method);

create index if not exists stage_logs_order_item_id_idx on public.stage_logs (order_item_id);
create index if not exists stage_logs_performed_by_idx on public.stage_logs (performed_by_user_id);
create index if not exists idx_stage_logs_order_item_occurred on public.stage_logs (order_item_id, occurred_at);

create index if not exists production_members_seller_id_idx on public.production_members (seller_id);
create index if not exists production_members_email_idx on public.production_members (lower(email));
create unique index if not exists production_members_invite_token_uq
  on public.production_members (invite_token) where invite_token is not null;

create index if not exists offline_order_syncs_device_idx
  on public.offline_order_syncs (seller_id, device_id);
create index if not exists idx_offline_order_syncs_seller_device
  on public.offline_order_syncs (seller_id, device_id, synced_at desc);

create index if not exists offline_qr_reservations_seller_idx
  on public.offline_qr_reservations (seller_id);
create index if not exists offline_qr_reservations_device_idx
  on public.offline_qr_reservations (device_id);
create index if not exists idx_offline_qr_reservations_device
  on public.offline_qr_reservations (seller_id, device_id, reserved_at);

create index if not exists order_event_history_order_id_idx on public.order_event_history (order_id);
create index if not exists idx_order_event_history_order_occurred
  on public.order_event_history (order_id, occurred_at);

create index if not exists event_change_logs_event_id_idx on public.event_change_logs (event_id);
create index if not exists idx_event_change_logs_event_occurred
  on public.event_change_logs (event_id, occurred_at);

create index if not exists reviews_seller_id_idx on public.reviews (seller_id);

create index if not exists sms_update_drafts_seller_id_idx on public.sms_update_drafts (seller_id);
create index if not exists sms_update_drafts_order_id_idx on public.sms_update_drafts (order_id);
create index if not exists idx_sms_update_drafts_seller_status
  on public.sms_update_drafts (seller_id, status, created_at desc);

-- ------------------------------------------------------------
-- Trigger helper functions for seller SMS drafts
-- ------------------------------------------------------------

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
    seller_id, order_id, triggered_by_user_id, message_text, status, created_at
  )
  values (
    p_seller_id, p_order_id, p_triggered_by_user_id, trim(p_message), 'ready', now()
  )
  returning id into v_draft_id;

  return v_draft_id;
end;
$$;

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
    select 1 from public.production_members pm
    where pm.auth_user_id = v_actor and pm.is_active = true
  ) then
    return new;
  end if;

  select * into v_item
  from public.order_items
  where id = new.order_item_id and cancelled_at is null;
  if not found then return new; end if;

  select * into v_order
  from public.orders
  where id = v_item.order_id and cancelled_at is null;
  if not found then return new; end if;

  select name into v_customer_name
  from public.customers where id = v_order.customer_id;

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
  if v_actor is null then return new; end if;

  if not (
    (tg_op = 'INSERT' and (v_new_status is null or v_new_status = 'confirmed'))
    or
    (tg_op = 'UPDATE' and v_new_status = 'confirmed' and v_old_status is distinct from 'confirmed')
  ) then
    return new;
  end if;

  select * into v_order
  from public.orders
  where id = new.order_id and cancelled_at is null;
  if not found or v_order.seller_id <> v_actor then return new; end if;

  select name into v_customer_name
  from public.customers where id = v_order.customer_id;

  v_message := format(
    'Hi %s, your payment of ₱%s for order #%s has been confirmed. Please check your order for the latest update.',
    coalesce(v_customer_name, 'there'),
    to_char(coalesce(new.amount,0), 'FM999999990.00'),
    v_order.order_number
  );

  perform public.queue_sms_update(v_order.seller_id, v_order.id, v_message, v_actor);
  return new;
end;
$$;

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
  where id = new.order_id and cancelled_at is null;
  if not found then return new; end if;

  select name into v_customer_name
  from public.customers where id = v_order.customer_id;

  select count(*) into v_item_count
  from public.order_items where order_id = new.order_id;

  select q.public_token into v_token
  from public.qr_codes q where q.id = new.qr_code_id limit 1;

  if v_item_count = 1 then
    v_message := format(
      'Hi %s, your order #%s has been created. Please check your order here: %s',
      coalesce(v_customer_name,'there'),
      v_order.order_number,
      case when v_token is null then '' else '/t/' || v_token end
    );
  else
    v_message := format(
      'Hi %s, your order #%s has been updated with %s × %s. Please check your order here: %s',
      coalesce(v_customer_name,'there'),
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
  if v_actor is null or new.seller_id <> v_actor then return new; end if;

  if new.event_id is distinct from old.event_id and new.event_id is not null then
    select name, event_date into v_event_name, v_event_date
    from public.events where id = new.event_id;

    select name into v_customer_name
    from public.customers where id = new.customer_id;

    v_message := format(
      'Hi %s, your pickup schedule for order #%s has changed to %s on %s. Please check your order here: %s',
      coalesce(v_customer_name,'there'),
      new.order_number,
      coalesce(v_event_name,'the new pickup event'),
      to_char(v_event_date,'FMMonth DD, YYYY'),
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
    select name into v_customer_name from public.customers where id = new.customer_id;

    v_message := format(
      'Hi %s, your pickup for order #%s was not claimed at the scheduled event. Please check your order for the next available pickup options.',
      coalesce(v_customer_name,'there'),
      new.order_number
    );

    perform public.queue_sms_update(new.seller_id, new.id, v_message, v_actor);
  end if;

  return new;
end;
$$;

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
  if v_actor is null or new.seller_id <> v_actor then return new; end if;

  if old.event_date is not distinct from new.event_date
     and old.start_time is not distinct from new.start_time
     and old.end_time is not distinct from new.end_time then
    return new;
  end if;

  v_old_schedule := to_char(old.event_date,'FMMonth DD, YYYY')
    || case when old.start_time is null then '' else ' ' || to_char(old.start_time,'HH24:MI') end;
  v_new_schedule := to_char(new.event_date,'FMMonth DD, YYYY')
    || case when new.start_time is null then '' else ' ' || to_char(new.start_time,'HH24:MI') end;

  for v_order in
    select o.*
    from public.orders o
    where o.seller_id = new.seller_id
      and o.event_id = new.id
      and o.cancelled_at is null
      and o.handed_over_at is null
  loop
    select c.name into v_customer_name from public.customers c where c.id=v_order.customer_id;

    select q.public_token into v_token
    from public.qr_codes q
    join public.order_items oi on oi.id=q.order_item_id
    where oi.order_id=v_order.id
    order by oi.created_at
    limit 1;

    v_message := format(
      'Hi %s, your pickup schedule for order #%s has changed from %s to %s. Please check your order here: %s',
      coalesce(v_customer_name,'there'), v_order.order_number,
      v_old_schedule, v_new_schedule,
      case when v_token is null then '' else '/t/' || v_token end
    );

    perform public.queue_sms_update(new.seller_id, v_order.id, v_message, v_actor);
  end loop;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- Triggers
-- ------------------------------------------------------------

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists production_stages_set_updated_at on public.production_stages;
create trigger production_stages_set_updated_at
before update on public.production_stages
for each row execute function public.set_updated_at();

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
before update on public.events
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists production_members_set_updated_at on public.production_members;
create trigger production_members_set_updated_at
before update on public.production_members
for each row execute function public.set_updated_at();

drop trigger if exists orders_pickup_sms_update on public.orders;
create trigger orders_pickup_sms_update
after update of event_id, pickup_status on public.orders
for each row execute function public.trg_order_pickup_sms_update();

drop trigger if exists events_schedule_sms_update on public.events;
create trigger events_schedule_sms_update
after update of event_date, start_time, end_time on public.events
for each row execute function public.trg_event_schedule_sms_update();

drop trigger if exists order_item_sms_update on public.order_items;
create trigger order_item_sms_update
after insert on public.order_items
for each row execute function public.trg_order_item_sms_update();

drop trigger if exists stage_log_sms_update on public.stage_logs;
create trigger stage_log_sms_update
after insert on public.stage_logs
for each row execute function public.trg_stage_log_sms_update();

drop trigger if exists payment_sms_update on public.payments;
create trigger payment_sms_update
after insert or update of proof_status on public.payments
for each row execute function public.trg_payment_sms_update();

-- ------------------------------------------------------------
-- Financial summary view
-- Uses only confirmed/direct payments for paid totals.
-- This is the intended accounting behavior for Ordeli.
-- ------------------------------------------------------------

drop view if exists public.order_financial_summary;
create view public.order_financial_summary
with (security_invoker = true)
as
select
  o.id as order_id,
  o.seller_id,
  o.order_number,
  coalesce(fin.order_total, 0::numeric) as order_total,
  coalesce(pay.total_paid, 0::numeric) as total_paid,
  greatest(coalesce(fin.order_total, 0::numeric) - coalesce(pay.total_paid, 0::numeric), 0::numeric) as remaining_balance
from public.orders o
left join (
  select order_items.order_id, sum(order_items.total_price) as order_total
  from public.order_items
  where order_items.cancelled_at is null
  group by order_items.order_id
) fin on fin.order_id = o.id
left join (
  select payments.order_id, sum(payments.amount) as total_paid
  from public.payments
  where payments.proof_status is null or payments.proof_status='confirmed'
  group by payments.order_id
) pay on pay.order_id = o.id
where o.cancelled_at is null;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

alter table public.sellers enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.production_stages enable row level security;
alter table public.events enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.qr_codes enable row level security;
alter table public.payments enable row level security;
alter table public.stage_logs enable row level security;
alter table public.production_members enable row level security;
alter table public.offline_order_syncs enable row level security;
alter table public.offline_qr_reservations enable row level security;
alter table public.order_event_history enable row level security;
alter table public.event_change_logs enable row level security;
alter table public.reviews enable row level security;
alter table public.sms_update_drafts enable row level security;

-- Policies are recreated explicitly so a restore is deterministic.

drop policy if exists seller_select_own on public.sellers;
create policy seller_select_own on public.sellers
for select to authenticated
using (id = (select auth.uid()));

drop policy if exists seller_update_own on public.sellers;
create policy seller_update_own on public.sellers
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists customer_insert_own on public.customers;
create policy customer_insert_own on public.customers
for insert to authenticated
with check (seller_id = (select auth.uid()));

drop policy if exists customer_select_own on public.customers;
create policy customer_select_own on public.customers
for select to authenticated
using (seller_id = (select auth.uid()));

drop policy if exists customer_update_own on public.customers;
create policy customer_update_own on public.customers
for update to authenticated
using (seller_id = (select auth.uid()))
with check (seller_id = (select auth.uid()));

drop policy if exists product_insert_own_shop on public.products;
create policy product_insert_own_shop on public.products
for insert to authenticated
with check (seller_id = (select auth.uid()));

drop policy if exists product_select_own_shop on public.products;
create policy product_select_own_shop on public.products
for select to authenticated
using (seller_id = (select auth.uid()));

drop policy if exists product_update_own_shop on public.products;
create policy product_update_own_shop on public.products
for update to authenticated
using (seller_id = (select auth.uid()))
with check (seller_id = (select auth.uid()));

drop policy if exists stage_insert_own_products on public.production_stages;
create policy stage_insert_own_products on public.production_stages
for insert to authenticated
with check (exists (
  select 1 from public.products p
  where p.id=production_stages.product_id and p.seller_id=(select auth.uid())
));

drop policy if exists stage_select_own_products on public.production_stages;
create policy stage_select_own_products on public.production_stages
for select to authenticated
using (exists (
  select 1 from public.products p
  where p.id=production_stages.product_id and p.seller_id=(select auth.uid())
));

drop policy if exists stage_update_own_products on public.production_stages;
create policy stage_update_own_products on public.production_stages
for update to authenticated
using (exists (
  select 1 from public.products p
  where p.id=production_stages.product_id and p.seller_id=(select auth.uid())
))
with check (exists (
  select 1 from public.products p
  where p.id=production_stages.product_id and p.seller_id=(select auth.uid())
));

drop policy if exists stage_delete_own_products on public.production_stages;
create policy stage_delete_own_products on public.production_stages
for delete to authenticated
using (exists (
  select 1 from public.products p
  where p.id=production_stages.product_id and p.seller_id=(select auth.uid())
));

drop policy if exists event_insert_own on public.events;
create policy event_insert_own on public.events
for insert to authenticated
with check (seller_id=(select auth.uid()));

drop policy if exists event_select_own on public.events;
create policy event_select_own on public.events
for select to authenticated
using (seller_id=(select auth.uid()));

drop policy if exists event_update_own on public.events;
create policy event_update_own on public.events
for update to authenticated
using (seller_id=(select auth.uid()))
with check (seller_id=(select auth.uid()));

drop policy if exists order_select_own on public.orders;
create policy order_select_own on public.orders
for select to authenticated
using (seller_id=(select auth.uid()));

drop policy if exists order_update_own on public.orders;
create policy order_update_own on public.orders
for update to authenticated
using (seller_id=(select auth.uid()))
with check (seller_id=(select auth.uid()));

drop policy if exists order_item_select_own on public.order_items;
create policy order_item_select_own on public.order_items
for select to authenticated
using (seller_id=(select auth.uid()));

drop policy if exists qr_select_own on public.qr_codes;
create policy qr_select_own on public.qr_codes
for select to authenticated
using (seller_id=(select auth.uid()));

drop policy if exists payment_select_own on public.payments;
create policy payment_select_own on public.payments
for select to authenticated
using (seller_id=(select auth.uid()));

drop policy if exists payment_insert_own on public.payments;
create policy payment_insert_own on public.payments
for insert to authenticated
with check (seller_id=(select auth.uid()));

drop policy if exists payment_update_own on public.payments;
create policy payment_update_own on public.payments
for update to authenticated
using (seller_id=(select auth.uid()))
with check (seller_id=(select auth.uid()));

drop policy if exists stage_log_select_own on public.stage_logs;
create policy stage_log_select_own on public.stage_logs
for select to authenticated
using (exists (
  select 1 from public.order_items oi
  where oi.id=stage_logs.order_item_id and oi.seller_id=(select auth.uid())
));

drop policy if exists stage_log_insert_own on public.stage_logs;
create policy stage_log_insert_own on public.stage_logs
for insert to authenticated
with check (
  exists (
    select 1 from public.order_items oi
    where oi.id=stage_logs.order_item_id and oi.seller_id=(select auth.uid())
  )
  and performed_by_user_id=(select auth.uid())
);

drop policy if exists stage_log_update_own on public.stage_logs;
create policy stage_log_update_own on public.stage_logs
for update to authenticated
using (exists (
  select 1 from public.order_items oi
  where oi.id=stage_logs.order_item_id and oi.seller_id=(select auth.uid())
))
with check (
  exists (
    select 1 from public.order_items oi
    where oi.id=stage_logs.order_item_id and oi.seller_id=(select auth.uid())
  )
  and performed_by_user_id=(select auth.uid())
);

drop policy if exists member_insert_own_shop on public.production_members;
create policy member_insert_own_shop on public.production_members
for insert to authenticated
with check (seller_id=(select auth.uid()));

drop policy if exists member_select_own_shop on public.production_members;
create policy member_select_own_shop on public.production_members
for select to authenticated
using (seller_id=(select auth.uid()));

drop policy if exists production_member_select_self on public.production_members;
create policy production_member_select_self on public.production_members
for select to authenticated
using (auth_user_id=(select auth.uid()));

drop policy if exists member_update_own_shop on public.production_members;
create policy member_update_own_shop on public.production_members
for update to authenticated
using (seller_id=(select auth.uid()))
with check (seller_id=(select auth.uid()));

drop policy if exists offline_order_syncs_owner on public.offline_order_syncs;
create policy offline_order_syncs_owner on public.offline_order_syncs
for select to authenticated
using (seller_id=(select auth.uid()));

drop policy if exists offline_qr_reservations_owner on public.offline_qr_reservations;
create policy offline_qr_reservations_owner on public.offline_qr_reservations
for select to authenticated
using (seller_id=(select auth.uid()));

drop policy if exists order_event_history_select_own on public.order_event_history;
create policy order_event_history_select_own on public.order_event_history
for select to authenticated
using (exists (
  select 1 from public.orders o
  where o.id=order_event_history.order_id and o.seller_id=(select auth.uid())
));

drop policy if exists order_event_history_insert_own on public.order_event_history;
create policy order_event_history_insert_own on public.order_event_history
for insert to authenticated
with check (exists (
  select 1 from public.orders o
  where o.id=order_event_history.order_id and o.seller_id=(select auth.uid())
));

drop policy if exists event_change_log_select_own on public.event_change_logs;
create policy event_change_log_select_own on public.event_change_logs
for select to authenticated
using (exists (
  select 1 from public.events e
  where e.id=event_change_logs.event_id and e.seller_id=(select auth.uid())
));

drop policy if exists event_change_log_insert_own on public.event_change_logs;
create policy event_change_log_insert_own on public.event_change_logs
for insert to authenticated
with check (exists (
  select 1 from public.events e
  where e.id=event_change_logs.event_id and e.seller_id=(select auth.uid())
));

drop policy if exists review_select_own on public.reviews;
create policy review_select_own on public.reviews
for select to authenticated
using (seller_id=(select auth.uid()));

drop policy if exists sms_draft_select_own on public.sms_update_drafts;
create policy sms_draft_select_own on public.sms_update_drafts
for select to authenticated
using (seller_id=(select auth.uid()));

drop policy if exists sms_draft_insert_own on public.sms_update_drafts;
create policy sms_draft_insert_own on public.sms_update_drafts
for insert to authenticated
with check (seller_id=(select auth.uid()));

drop policy if exists sms_draft_update_own on public.sms_update_drafts;
create policy sms_draft_update_own on public.sms_update_drafts
for update to authenticated
using (seller_id=(select auth.uid()))
with check (seller_id=(select auth.uid()));

-- ------------------------------------------------------------
-- Storage buckets
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('payment-proofs','payment-proofs',false,8388608,array['image/jpeg','image/png','image/webp']),
  ('production-proofs','production-proofs',false,8388608,array['image/jpeg','image/png','image/webp']),
  ('shop-logos','shop-logos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  name=excluded.name,
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

-- Storage policies rely on Supabase Storage's managed storage.objects table.

drop policy if exists "Sellers can upload own shop logo" on storage.objects;
create policy "Sellers can upload own shop logo" on storage.objects
for insert to authenticated
with check (
  bucket_id='shop-logos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists "Sellers can view own shop logo" on storage.objects;
create policy "Sellers can view own shop logo" on storage.objects
for select to authenticated
using (
  bucket_id='shop-logos'
  and owner_id=(select auth.uid())::text
);

drop policy if exists shop_logo_update_own on storage.objects;
create policy shop_logo_update_own on storage.objects
for update to authenticated
using (
  bucket_id='shop-logos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
)
with check (
  bucket_id='shop-logos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists shop_logo_delete_own on storage.objects;
create policy shop_logo_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id='shop-logos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists payment_proof_insert_own on storage.objects;
create policy payment_proof_insert_own on storage.objects
for insert to authenticated
with check (
  bucket_id='payment-proofs'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists payment_proof_select_own on storage.objects;
create policy payment_proof_select_own on storage.objects
for select to authenticated
using (
  bucket_id='payment-proofs'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists payment_proof_delete_own on storage.objects;
create policy payment_proof_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id='payment-proofs'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists seller_can_read_payment_proofs on storage.objects;
create policy seller_can_read_payment_proofs on storage.objects
for select to authenticated
using (
  bucket_id='payment-proofs'
  and exists (
    select 1 from public.payments p
    where p.proof_path=objects.name and p.seller_id=(select auth.uid())
  )
);

drop policy if exists seller_can_delete_payment_proofs on storage.objects;
create policy seller_can_delete_payment_proofs on storage.objects
for delete to authenticated
using (
  bucket_id='payment-proofs'
  and exists (
    select 1 from public.payments p
    where p.proof_path=objects.name and p.seller_id=(select auth.uid())
  )
);

drop policy if exists production_proof_insert_own on storage.objects;
create policy production_proof_insert_own on storage.objects
for insert to authenticated
with check (
  bucket_id='production-proofs'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists production_proof_select_own on storage.objects;
create policy production_proof_select_own on storage.objects
for select to authenticated
using (
  bucket_id='production-proofs'
  and exists (
    select 1
    from public.stage_logs sl
    join public.order_items oi on oi.id=sl.order_item_id
    where sl.proof_photo_path=objects.name and oi.seller_id=(select auth.uid())
  )
);

drop policy if exists production_proof_delete_own on storage.objects;
create policy production_proof_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id='production-proofs'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

commit;

-- ============================================================
-- NOTE ABOUT RPC FUNCTIONS
--
-- The live project still contains a few obsolete SECURITY DEFINER
-- functions that reference retired objects such as:
--   seller_profiles, qr_series, order_item_production_stages
--
-- Those legacy functions were intentionally omitted from this
-- restore script because including them would make a clean restore
-- fail or recreate dead schema that is not part of the current app.
--
-- The current application's RPCs should be migrated into a proper
-- versioned migrations folder next, so the database can become fully
-- reproducible from source control.
-- ============================================================

-- ============================================================
-- LIVE DATABASE INCREMENTAL CHANGES
-- Applied to the live Ordeli project after the baseline ordeli.sql
-- ============================================================

BEGIN;

-- ============================================================
-- SHOP GEOLOCATION
-- ============================================================

ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS shop_latitude double precision,
  ADD COLUMN IF NOT EXISTS shop_longitude double precision;

-- ============================================================
-- PRODUCT MEDIA
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_path text;

-- ============================================================
-- SELLER BRANCHES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.seller_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_branches_name_check
    CHECK (length(trim(name)) > 0),
  CONSTRAINT seller_branches_address_check
    CHECK (length(trim(address)) > 0),
  CONSTRAINT seller_branches_latitude_check
    CHECK (latitude >= -90 AND latitude <= 90),
  CONSTRAINT seller_branches_longitude_check
    CHECK (longitude >= -180 AND longitude <= 180)
);

CREATE INDEX IF NOT EXISTS seller_branches_seller_id_idx
  ON public.seller_branches(seller_id);

CREATE UNIQUE INDEX IF NOT EXISTS seller_branches_one_default_per_seller
  ON public.seller_branches(seller_id)
  WHERE is_default = true;

ALTER TABLE public.seller_branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seller_branches_select_own ON public.seller_branches;
CREATE POLICY seller_branches_select_own
ON public.seller_branches
FOR SELECT
TO authenticated
USING ((select auth.uid()) = seller_id);

DROP POLICY IF EXISTS seller_branches_insert_own ON public.seller_branches;
CREATE POLICY seller_branches_insert_own
ON public.seller_branches
FOR INSERT
TO authenticated
WITH CHECK ((select auth.uid()) = seller_id);

DROP POLICY IF EXISTS seller_branches_update_own ON public.seller_branches;
CREATE POLICY seller_branches_update_own
ON public.seller_branches
FOR UPDATE
TO authenticated
USING ((select auth.uid()) = seller_id)
WITH CHECK ((select auth.uid()) = seller_id);

DROP POLICY IF EXISTS seller_branches_delete_own ON public.seller_branches;
CREATE POLICY seller_branches_delete_own
ON public.seller_branches
FOR DELETE
TO authenticated
USING ((select auth.uid()) = seller_id);

-- ============================================================
-- ORDER PICKUP BRANCH
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pickup_branch_id uuid;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_pickup_branch_id_fkey;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_pickup_branch_id_fkey
  FOREIGN KEY (pickup_branch_id)
  REFERENCES public.seller_branches(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_pickup_branch_id_idx
  ON public.orders(pickup_branch_id);

-- ============================================================
-- PRODUCT IMAGE STORAGE
-- ============================================================

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'product-images',
  'product-images',
  false,
  8388608,
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = 8388608,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

DROP POLICY IF EXISTS product_images_insert_own ON storage.objects;
CREATE POLICY product_images_insert_own
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (select auth.uid())::text
);

DROP POLICY IF EXISTS product_images_select_own ON storage.objects;
CREATE POLICY product_images_select_own
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (select auth.uid())::text
);

DROP POLICY IF EXISTS product_images_update_own ON storage.objects;
CREATE POLICY product_images_update_own
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (select auth.uid())::text
)
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (select auth.uid())::text
);

DROP POLICY IF EXISTS product_images_delete_own ON storage.objects;
CREATE POLICY product_images_delete_own
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (select auth.uid())::text
);

-- ============================================================
-- CUSTOMER FULFILLMENT: CURRENT VERSION
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_customer_fulfillment(p_public_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
declare
  v_qr public.qr_codes%rowtype;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_shop_name text;
  v_shop_address text;
  v_shop_latitude double precision;
  v_shop_longitude double precision;
  v_shop_logo_path text;
  v_total numeric(12,2) := 0;
  v_paid numeric(12,2) := 0;
  v_production_complete boolean := false;
  v_current_event jsonb := null;
  v_current_branch jsonb := null;
  v_events jsonb := '[]'::jsonb;
  v_branches jsonb := '[]'::jsonb;
  v_items_total integer := 0;
  v_items_complete integer := 0;
begin
  if nullif(trim(coalesce(p_public_token,'')),'') is null then
    raise exception 'Tracking token is required.';
  end if;

  select q.* into v_qr
  from public.qr_codes q
  where q.public_token=p_public_token
    and q.status='assigned'
    and q.order_item_id is not null
  limit 1;

  if not found then
    raise exception 'This tracking link is unavailable.';
  end if;

  select oi.* into v_item
  from public.order_items oi
  where oi.id=v_qr.order_item_id;

  if not found then
    raise exception 'This tracking link is unavailable.';
  end if;

  select * into v_order
  from public.orders
  where id=v_item.order_id;

  if not found then
    raise exception 'This order is unavailable.';
  end if;

  select shop_name,shop_address,shop_latitude,shop_longitude,shop_logo_path
  into v_shop_name,v_shop_address,v_shop_latitude,v_shop_longitude,v_shop_logo_path
  from public.sellers
  where id=v_order.seller_id;

  select coalesce(sum(oi.total_price),0)::numeric(12,2),count(*)::integer
  into v_total,v_items_total
  from public.order_items oi
  where oi.order_id=v_order.id
    and oi.seller_id=v_order.seller_id
    and oi.cancelled_at is null;

  select coalesce(sum(p.amount),0)::numeric(12,2)
  into v_paid
  from public.payments p
  where p.order_id=v_order.id
    and p.seller_id=v_order.seller_id
    and (p.proof_status is null or p.proof_status='confirmed');

  select count(*)::integer into v_items_complete
  from public.order_items oi
  where oi.order_id=v_order.id
    and oi.seller_id=v_order.seller_id
    and oi.cancelled_at is null
    and (
      jsonb_array_length(coalesce(oi.workflow_snapshot,'[]'::jsonb))=0
      or not exists (
        select 1
        from jsonb_array_elements(coalesce(oi.workflow_snapshot,'[]'::jsonb)) st
        where not exists (
          select 1
          from public.stage_logs sl
          where sl.order_item_id=oi.id
            and sl.stage_order=(st->>'stage_order')::integer
            and sl.action='finished'
            and not exists (
              select 1
              from public.stage_logs newer
              where newer.order_item_id=sl.order_item_id
                and newer.stage_order=sl.stage_order
                and newer.action='sent_back'
                and newer.occurred_at>sl.occurred_at
            )
        )
      )
    );

  v_production_complete := v_items_total > 0 and v_items_complete = v_items_total;

  if v_order.event_id is not null then
    select jsonb_build_object(
      'id',e.id,
      'name',e.name,
      'location',e.location,
      'event_date',e.event_date,
      'start_time',e.start_time,
      'end_time',e.end_time,
      'status',e.status
    )
    into v_current_event
    from public.events e
    where e.id=v_order.event_id
      and e.seller_id=v_order.seller_id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',e.id,
        'name',e.name,
        'location',e.location,
        'event_date',e.event_date,
        'start_time',e.start_time,
        'end_time',e.end_time,
        'notes',e.notes
      )
      order by e.event_date,e.start_time nulls last,e.name
    ),'[]'::jsonb
  )
  into v_events
  from public.events e
  where e.seller_id=v_order.seller_id
    and lower(e.status) in ('upcoming','ready','active')
    and e.event_date>=current_date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',b.id,
        'name',b.name,
        'address',b.address,
        'latitude',b.latitude,
        'longitude',b.longitude,
        'is_active',b.is_active,
        'is_default',b.is_default
      )
      order by b.is_default desc,b.name
    ),'[]'::jsonb
  )
  into v_branches
  from public.seller_branches b
  where b.seller_id=v_order.seller_id
    and b.is_active=true;

  if v_order.pickup_branch_id is not null then
    select jsonb_build_object(
      'id',b.id,
      'name',b.name,
      'address',b.address,
      'latitude',b.latitude,
      'longitude',b.longitude,
      'is_active',b.is_active,
      'is_default',b.is_default
    )
    into v_current_branch
    from public.seller_branches b
    where b.id=v_order.pickup_branch_id
      and b.seller_id=v_order.seller_id;
  end if;

  return jsonb_build_object(
    'order_id',v_order.id,
    'order_number',v_order.order_number,
    'customer_name',(select c.name from public.customers c where c.id=v_order.customer_id),
    'shop',jsonb_build_object(
      'name',v_shop_name,
      'address',v_shop_address,
      'latitude',v_shop_latitude,
      'longitude',v_shop_longitude,
      'logo_path',v_shop_logo_path
    ),
    'branches',v_branches,
    'pickup_branch_id',v_order.pickup_branch_id,
    'pickup_branch',v_current_branch,
    'production_completed',v_production_complete,
    'production_items_total',v_items_total,
    'production_items_complete',v_items_complete,
    'payment_total',v_total,
    'payment_paid',v_paid,
    'payment_remaining',greatest(v_total-v_paid,0),
    'fully_paid',v_paid>=v_total,
    'fulfillment_type',v_order.fulfillment_type,
    'pickup_status',v_order.pickup_status,
    'handed_over_at',v_order.handed_over_at,
    'event',v_current_event,
    'events',v_events
  );
end;
$function$;

-- ============================================================
-- CUSTOMER FULFILLMENT SAVE: CURRENT VERSION
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_customer_fulfillment(
  p_public_token text,
  p_fulfillment_type text,
  p_event_id uuid DEFAULT NULL::uuid,
  p_branch_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
declare
  v_qr public.qr_codes%rowtype;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_event public.events%rowtype;
  v_branch public.seller_branches%rowtype;
  v_total numeric(12,2) := 0;
  v_paid numeric(12,2) := 0;
  v_items_total integer := 0;
  v_items_complete integer := 0;
  v_next_fulfillment text;
  v_next_pickup_status text;
begin
  if nullif(trim(p_public_token), '') is null then
    raise exception 'Tracking token is required.';
  end if;

  if p_fulfillment_type not in ('shop','location','courier') then
    raise exception 'Invalid fulfillment type.';
  end if;

  select * into v_qr
  from public.qr_codes
  where public_token = p_public_token
    and status = 'assigned'
  limit 1;

  if not found or v_qr.order_item_id is null then
    raise exception 'Tracking link not found.';
  end if;

  select * into v_item
  from public.order_items
  where id = v_qr.order_item_id
    and cancelled_at is null
  limit 1;

  if not found then
    raise exception 'Order item not found.';
  end if;

  select * into v_order
  from public.orders
  where id = v_item.order_id
    and cancelled_at is null
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;

  select coalesce(sum(oi.total_price),0)::numeric(12,2), count(*)::integer
  into v_total,v_items_total
  from public.order_items oi
  where oi.order_id=v_order.id
    and oi.cancelled_at is null;

  select count(*)::integer into v_items_complete
  from public.order_items oi
  where oi.order_id=v_order.id
    and oi.cancelled_at is null
    and (
      jsonb_array_length(coalesce(oi.workflow_snapshot,'[]'::jsonb))=0
      or (
        select count(*)
        from jsonb_array_elements(coalesce(oi.workflow_snapshot,'[]'::jsonb)) st
        where exists (
          select 1
          from public.stage_logs sl
          where sl.order_item_id=oi.id
            and sl.stage_order=(st->>'stage_order')::integer
            and sl.action='finished'
            and not exists (
              select 1
              from public.stage_logs newer
              where newer.order_item_id=oi.id
                and newer.stage_order=sl.stage_order
                and newer.action='sent_back'
                and newer.occurred_at>sl.occurred_at
            )
        )
      ) = jsonb_array_length(coalesce(oi.workflow_snapshot,'[]'::jsonb))
    );

  select coalesce(sum(p.amount),0)::numeric(12,2)
  into v_paid
  from public.payments p
  where p.order_id=v_order.id
    and (p.proof_status is null or p.proof_status='confirmed');

  if v_items_total=0 then
    raise exception 'There are no active items in this order.';
  end if;

  if v_items_complete<>v_items_total then
    raise exception 'Production must be completed before choosing fulfillment.';
  end if;

  if v_paid<v_total then
    raise exception 'Payment must be fully confirmed before choosing fulfillment.';
  end if;

  if p_fulfillment_type='location' then
    select * into v_event
    from public.events
    where id=p_event_id
      and seller_id=v_order.seller_id
      and lower(status) in ('upcoming','ready','active')
      and event_date>=current_date
    limit 1;

    if not found then
      raise exception 'Selected pickup event is not available.';
    end if;

    v_next_fulfillment:='location';
    v_next_pickup_status:='scheduled';
    p_branch_id:=null;

  elsif p_fulfillment_type='shop' then

    if p_branch_id is not null then
      select * into v_branch
      from public.seller_branches
      where id=p_branch_id
        and seller_id=v_order.seller_id
        and is_active=true
      limit 1;

      if not found then
        raise exception 'Selected shop branch is not available.';
      end if;
    end if;

    v_next_fulfillment:='shop';
    v_next_pickup_status:='not_scheduled';
    p_event_id:=null;

  else
    v_next_fulfillment:='courier';
    v_next_pickup_status:='not_scheduled';
    p_event_id:=null;
    p_branch_id:=null;
  end if;

  update public.orders
  set fulfillment_type=v_next_fulfillment,
      event_id=p_event_id,
      pickup_branch_id=p_branch_id,
      pickup_status=v_next_pickup_status,
      updated_at=now()
  where id=v_order.id;

  return jsonb_build_object(
    'order_id',v_order.id,
    'fulfillment_type',v_next_fulfillment,
    'event_id',p_event_id,
    'pickup_branch_id',p_branch_id,
    'pickup_status',v_next_pickup_status
  );
end;
$function$;

-- ============================================================
-- CUSTOMER TRACKING: CURRENT VERSION WITH MEDIA + BRANCH
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_customer_tracking(p_public_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
declare
  v_qr public.qr_codes%rowtype;
  v_order public.orders%rowtype;
  v_seller public.sellers%rowtype;
  v_item public.order_items%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
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
  v_pickup_branch jsonb := null;
begin
  if p_public_token is null or length(trim(p_public_token)) < 16 then
    raise exception 'Invalid tracking link.' using errcode = '22023';
  end if;

  select * into v_qr
  from public.qr_codes
  where public_token=trim(p_public_token)
    and status='assigned'
    and order_item_id is not null;

  if not found then
    raise exception 'Tracking link not found or no longer available.' using errcode='P0002';
  end if;

  select * into v_item
  from public.order_items
  where id=v_qr.order_item_id
    and seller_id=v_qr.seller_id;

  if not found then
    raise exception 'Tracked order item was not found.' using errcode='P0002';
  end if;

  select * into v_order
  from public.orders
  where id=v_item.order_id
    and seller_id=v_qr.seller_id;

  if not found then
    raise exception 'Tracked order was not found.' using errcode='P0002';
  end if;

  select * into v_seller
  from public.sellers
  where id=v_qr.seller_id;

  if not found then
    raise exception 'Shop was not found.' using errcode='P0002';
  end if;

  if v_order.pickup_branch_id is not null then
    select jsonb_build_object(
      'id',b.id,
      'name',b.name,
      'address',b.address,
      'latitude',b.latitude,
      'longitude',b.longitude,
      'is_active',b.is_active,
      'is_default',b.is_default
    )
    into v_pickup_branch
    from public.seller_branches b
    where b.id=v_order.pickup_branch_id
      and b.seller_id=v_order.seller_id;
  end if;

  select
    coalesce(sum(oi.total_price),0),
    coalesce((
      select sum(p.amount)
      from public.payments p
      where p.order_id=v_order.id
        and p.seller_id=v_order.seller_id
        and (p.proof_status is null or p.proof_status='confirmed')
    ),0)
  into v_total,v_paid
  from public.order_items oi
  where oi.order_id=v_order.id
    and oi.seller_id=v_order.seller_id
    and oi.cancelled_at is null;

  if v_paid<=0 then
    v_payment_status:='unpaid';
  elsif v_paid<v_total then
    if exists (
      select 1 from public.payments p
      where p.order_id=v_order.id
        and p.seller_id=v_order.seller_id
        and p.proof_status='pending_verification'
    ) then
      v_payment_status:='pending_verification';
    elsif exists (
      select 1 from public.payments p
      where p.order_id=v_order.id
        and p.seller_id=v_order.seller_id
        and p.proof_status='rejected'
    ) then
      v_payment_status:='rejected';
    else
      v_payment_status:='partially_paid';
    end if;
  else
    v_payment_status:='fully_paid';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',p.id,
        'amount',p.amount,
        'payment_type',p.payment_type,
        'proof_status',p.proof_status,
        'payment_method',p.payment_method,
        'rejection_reason',p.rejection_reason,
        'created_at',p.created_at,
        'source',case when p.proof_path like 'incoming/%' then 'customer' else 'seller' end
      ) order by p.created_at
    ),'[]'::jsonb
  ) into v_history
  from public.payments p
  where p.order_id=v_order.id
    and p.seller_id=v_order.seller_id;

  if jsonb_typeof(v_item.workflow_snapshot)='array' then
    for v_stage in
      select value from jsonb_array_elements(v_item.workflow_snapshot)
      order by (value->>'stage_order')::integer
    loop
      v_target_stage:=(v_stage->>'stage_order')::integer;

      select sl.action,sl.occurred_at,sl.proof_photo_path
      into v_latest_action,v_latest_at,v_latest_proof_path
      from public.stage_logs sl
      where sl.order_item_id=v_item.id
        and sl.stage_order=v_target_stage
      order by sl.occurred_at desc
      limit 1;

      if v_latest_action='finished' then
        v_stage_status:='finished';
      else
        if v_all_done and not v_has_active_stage then
          v_stage_status:='in_progress';
          v_has_active_stage:=true;
        else
          v_stage_status:='upcoming';
          v_all_done:=false;
        end if;
      end if;

      if v_stage_status<>'finished' then
        v_all_done:=false;
      end if;

      v_stages:=v_stages||jsonb_build_array(
        jsonb_build_object(
          'stage_order',v_target_stage,
          'name',coalesce(v_stage->>'name','Stage'),
          'status',v_stage_status,
          'has_photo',(v_stage_status='finished' and v_latest_proof_path is not null),
          'finished_at',case when v_stage_status='finished' then v_latest_at else null end
        )
      );
    end loop;
  end if;

  if jsonb_array_length(v_stages)=0 or not exists (
    select 1 from jsonb_array_elements(v_stages) s
    where s->>'status'<>'finished'
  ) then
    v_all_done:=true;
  else
    v_all_done:=false;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',oi.id,
        'product_name',oi.product_name,
        'quantity',oi.quantity,
        'cancelled',oi.cancelled_at is not null,
        'product_image_path',(
          select p.image_path
          from public.products p
          where p.id=oi.product_id
            and p.seller_id=oi.seller_id
        ),
        'production_status',case
          when oi.cancelled_at is not null then 'cancelled'
          when jsonb_typeof(oi.workflow_snapshot)<>'array'
            or jsonb_array_length(oi.workflow_snapshot)=0 then 'completed'
          when not exists (
            select 1
            from jsonb_array_elements(oi.workflow_snapshot) s
            where not exists (
              select 1
              from public.stage_logs sl
              where sl.order_item_id=oi.id
                and sl.stage_order=(s->>'stage_order')::integer
                and sl.action='finished'
                and sl.occurred_at=(
                  select max(sl2.occurred_at)
                  from public.stage_logs sl2
                  where sl2.order_item_id=oi.id
                    and sl2.stage_order=sl.stage_order
                )
            )
          ) then 'completed'
          else 'in_progress'
        end
      ) order by oi.created_at
    ),'[]'::jsonb
  ) into v_items
  from public.order_items oi
  where oi.order_id=v_order.id
    and oi.seller_id=v_order.seller_id;

  return jsonb_build_object(
    'shop',jsonb_build_object(
      'name',v_seller.shop_name,
      'address',v_seller.shop_address,
      'latitude',v_seller.shop_latitude,
      'longitude',v_seller.shop_longitude,
      'logo_path',v_seller.shop_logo_path
    ),
    'order',jsonb_build_object(
      'order_number',v_order.order_number,
      'created_at',v_order.created_at,
      'cancelled_at',v_order.cancelled_at,
      'handed_over_at',v_order.handed_over_at,
      'fulfillment_type',v_order.fulfillment_type,
      'pickup_status',v_order.pickup_status,
      'event_id',v_order.event_id,
      'pickup_branch_id',v_order.pickup_branch_id
    ),
    'pickup_branch',v_pickup_branch,
    'item',jsonb_build_object(
      'id',v_item.id,
      'product_name',v_item.product_name,
      'quantity',v_item.quantity,
      'total_price',v_item.total_price,
      'cancelled_at',v_item.cancelled_at,
      'production_completed',v_all_done,
      'production_stages',v_stages,
      'product_image_path',(
        select p.image_path
        from public.products p
        where p.id=v_item.product_id
          and p.seller_id=v_item.seller_id
      )
    ),
    'order_items',v_items,
    'payment',jsonb_build_object(
      'total',round(v_total,2),
      'paid',round(v_paid,2),
      'remaining',round(greatest(v_total-v_paid,0),2),
      'status',v_payment_status,
      'history',v_history
    )
  );
end;
$function$;

-- ============================================================
-- RPC GRANTS
-- ============================================================

GRANT EXECUTE ON FUNCTION public.get_customer_fulfillment(text)
TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_customer_tracking(text)
TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_customer_fulfillment(text,text,uuid,uuid)
TO anon, authenticated;

COMMIT;

-- ============================================================
-- IMPORTANT RESTORE NOTE
-- ============================================================
-- This file is a CURRENT SCHEMA restore, assembled from:
--   1) the uploaded Ordeli baseline ordeli.sql
--   2) the live database changes applied afterwards
--
-- It is intended to recreate database structure, functions, RLS,
-- indexes, storage buckets/policies, and related configuration.
-- It does NOT contain production row data or Supabase Auth users.
--
-- The QR generator fix discussed later (globally unique QR codes
-- across sellers with the product UUID portion in the code) was
-- provided as a query but was NOT applied to the live database at
-- the time this file was generated, so it is intentionally not
-- included here.
-- ============================================================
