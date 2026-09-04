-- Ordeli: harden the EXISTING database schema.
-- This migration is intentionally additive and matches the schema exported
-- from Supabase on 2026-09-04. It does NOT introduce selected_event_id.
-- Existing orders use orders.event_id.

begin;

-- -------------------------------------------------------------------------
-- Extensions used by the application.
-- -------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- -------------------------------------------------------------------------
-- Missing/important indexes. These are safe to create repeatedly.
-- -------------------------------------------------------------------------
create index if not exists idx_production_members_seller_id
  on public.production_members (seller_id);

create index if not exists idx_products_seller_id_active
  on public.products (seller_id, is_active);

create index if not exists idx_production_stages_product_order
  on public.production_stages (product_id, stage_order);

create index if not exists idx_qr_codes_seller_status
  on public.qr_codes (seller_id, status);

create index if not exists idx_qr_codes_product_status
  on public.qr_codes (product_id, status);

create index if not exists idx_qr_codes_order_item_id
  on public.qr_codes (order_item_id)
  where order_item_id is not null;

create index if not exists idx_customers_seller_name
  on public.customers (seller_id, name);

create index if not exists idx_events_seller_date
  on public.events (seller_id, event_date, start_time);

create index if not exists idx_orders_seller_created
  on public.orders (seller_id, created_at desc);

create index if not exists idx_orders_seller_event
  on public.orders (seller_id, event_id)
  where event_id is not null;

create index if not exists idx_order_items_order
  on public.order_items (order_id);

create index if not exists idx_order_items_seller
  on public.order_items (seller_id);

create index if not exists idx_stage_logs_order_item_occurred
  on public.stage_logs (order_item_id, occurred_at);

create index if not exists idx_payments_order_created
  on public.payments (order_id, created_at);

create index if not exists idx_order_event_history_order_occurred
  on public.order_event_history (order_id, occurred_at);

create index if not exists idx_event_change_logs_event_occurred
  on public.event_change_logs (event_id, occurred_at);

create index if not exists idx_sms_update_drafts_seller_status
  on public.sms_update_drafts (seller_id, status, created_at desc);

create index if not exists idx_offline_qr_reservations_device
  on public.offline_qr_reservations (seller_id, device_id, reserved_at);

create index if not exists idx_offline_order_syncs_seller_device
  on public.offline_order_syncs (seller_id, device_id, synced_at desc);

-- -------------------------------------------------------------------------
-- Data integrity checks that match the finalized product rules.
-- NOT VALID lets existing data remain untouched while still enforcing new
-- rows immediately. Existing rows can be validated later after cleanup.
-- -------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_default_price_nonnegative'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_default_price_nonnegative
      check (default_price >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_quantity_positive'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_quantity_positive
      check (quantity > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_unit_price_nonnegative'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_unit_price_nonnegative
      check (unit_price >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_total_price_nonnegative'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_total_price_nonnegative
      check (total_price >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_amount_positive'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_amount_positive
      check (amount > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reviews_rating_range'
      and conrelid = 'public.reviews'::regclass
  ) then
    alter table public.reviews
      add constraint reviews_rating_range
      check (rating between 1 and 5) not valid;
  end if;
end $$;

-- -------------------------------------------------------------------------
-- QR assignment must be one QR -> zero or one order item.
-- A partial unique index expresses this safely without changing the current
-- nullable column design.
-- -------------------------------------------------------------------------
create unique index if not exists uq_qr_codes_assigned_order_item
  on public.qr_codes (order_item_id)
  where order_item_id is not null;

-- -------------------------------------------------------------------------
-- A review is already unique per order according to the exported schema.
-- Keep the explicit partial/defensive index in case the unique constraint
-- is represented differently after a future migration.
-- -------------------------------------------------------------------------
create unique index if not exists uq_reviews_order_id
  on public.reviews (order_id);

-- -------------------------------------------------------------------------
-- -------------------------------------------------------------------------
-- Helpful authenticated seller reporting view. Aggregate items and payments
-- independently so multiple items/payments never multiply each other.
-- -------------------------------------------------------------------------
create or replace view public.order_financial_summary
with (security_invoker = true)
as
select
  o.id as order_id,
  o.seller_id,
  o.order_number,
  coalesce(fin.order_total, 0)::numeric as order_total,
  coalesce(pay.total_paid, 0)::numeric as total_paid,
  greatest(
    coalesce(fin.order_total, 0)::numeric - coalesce(pay.total_paid, 0)::numeric,
    0
  )::numeric as remaining_balance
from public.orders o
left join (
  select order_id, sum(total_price)::numeric as order_total
  from public.order_items
  where cancelled_at is null
  group by order_id
) fin on fin.order_id = o.id
left join (
  select order_id, sum(amount)::numeric as total_paid
  from public.payments
  group by order_id
) pay on pay.order_id = o.id
where o.cancelled_at is null;

commit;
