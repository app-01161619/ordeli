
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
