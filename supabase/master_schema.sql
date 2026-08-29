-- ORDELI MASTER SCHEMA
-- Finalized master-prompt database foundation.
-- Run this after deleting the old prototype tables/functions if they
-- contain no data you need. This file intentionally does not reset data.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.sellers (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  login_method text not null default 'email'
    check (login_method in ('email','google')),
  google_id text,
  shop_name text,
  shop_address text,
  shop_logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index sellers_google_id_unique
on public.sellers(google_id) where google_id is not null;

create trigger sellers_set_updated_at
before update on public.sellers for each row
execute function public.set_updated_at();

create table public.production_members (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  section_label text,
  role text not null default 'production_member'
    check (role = 'production_member'),
  can_view_production boolean not null default true,
  can_scan_qr boolean not null default true,
  can_finish_stage boolean not null default true,
  can_upload_proof boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index production_members_seller_id_idx
on public.production_members(seller_id);

create trigger production_members_set_updated_at
before update on public.production_members for each row
execute function public.set_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  name text not null,
  default_price numeric(12,2) not null default 0
    check (default_price >= 0),
  customer_cancellable_until_stage integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(name)) > 0),
  check (
    customer_cancellable_until_stage is null
    or customer_cancellable_until_stage > 0
  )
);

create index products_seller_id_idx
on public.products(seller_id);

create trigger products_set_updated_at
before update on public.products for each row
execute function public.set_updated_at();

create table public.production_stages (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  stage_order integer not null check (stage_order > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(name)) > 0),
  unique (product_id, stage_order)
);

create index production_stages_product_id_idx
on public.production_stages(product_id);

create trigger production_stages_set_updated_at
before update on public.production_stages for each row
execute function public.set_updated_at();

create table public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  code text not null unique,
  public_token text not null unique,
  status text not null default 'available'
    check (status in ('available','assigned','revoked')),
  order_item_id uuid,
  assigned_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index qr_codes_seller_id_idx on public.qr_codes(seller_id);
create index qr_codes_product_id_idx on public.qr_codes(product_id);
create index qr_codes_status_idx on public.qr_codes(status);
create index qr_codes_order_item_id_idx on public.qr_codes(order_item_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(name)) > 0)
);

create index customers_seller_id_idx on public.customers(seller_id);
create index customers_seller_phone_idx on public.customers(seller_id, phone);

create trigger customers_set_updated_at
before update on public.customers for each row
execute function public.set_updated_at();

create table public.events (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  name text not null,
  location text not null,
  event_date date not null,
  start_time time,
  end_time time,
  notes text,
  status text not null default 'upcoming'
    check (status in ('upcoming','ready','active','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(name)) > 0),
  check (length(trim(location)) > 0),
  check (end_time is null or start_time is null or end_time > start_time)
);

create index events_seller_id_idx on public.events(seller_id);
create index events_seller_date_idx on public.events(seller_id, event_date);

create trigger events_set_updated_at
before update on public.events for each row
execute function public.set_updated_at();

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  order_number bigint generated always as identity,
  fulfillment_type text not null default 'not_selected'
    check (fulfillment_type in ('not_selected','pickup_shop','pickup_location','courier')),
  event_id uuid references public.events(id) on delete restrict,
  pickup_status text not null default 'not_scheduled'
    check (pickup_status in (
      'not_scheduled','scheduled','bring_to_event',
      'unclaimed','rescheduled','handed_over'
    )),
  handed_over_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index orders_seller_order_number_unique
on public.orders(seller_id, order_number);

create index orders_seller_id_idx on public.orders(seller_id);
create index orders_customer_id_idx on public.orders(customer_id);
create index orders_event_id_idx on public.orders(event_id);
create index orders_created_at_idx on public.orders(created_at);

create trigger orders_set_updated_at
before update on public.orders for each row
execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  seller_id uuid not null references public.sellers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  qr_code_id uuid references public.qr_codes(id) on delete restrict,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  total_price numeric(12,2) not null check (total_price >= 0),
  workflow_snapshot jsonb not null default '[]'::jsonb,
  cancellable_until_stage integer,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(product_name)) > 0),
  check (jsonb_typeof(workflow_snapshot) = 'array'),
  check (cancellable_until_stage is null or cancellable_until_stage > 0)
);

create index order_items_order_id_idx on public.order_items(order_id);
create index order_items_seller_id_idx on public.order_items(seller_id);
create index order_items_product_id_idx on public.order_items(product_id);
create unique index order_items_qr_unique
on public.order_items(qr_code_id)
where qr_code_id is not null;

create trigger order_items_set_updated_at
before update on public.order_items for each row
execute function public.set_updated_at();

alter table public.qr_codes
add constraint qr_codes_order_item_fk
foreign key (order_item_id)
references public.order_items(id)
on delete restrict;

create unique index qr_codes_assigned_order_item_unique
on public.qr_codes(order_item_id)
where order_item_id is not null and status = 'assigned';

create table public.stage_logs (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  stage_order integer not null check (stage_order > 0),
  stage_name text not null,
  action text not null check (action in ('finished','sent_back')),
  performed_by_user_id uuid references auth.users(id) on delete set null,
  note text,
  proof_photo_path text,
  occurred_at timestamptz not null default now(),
  check (length(trim(stage_name)) > 0)
);

create index stage_logs_order_item_id_idx on public.stage_logs(order_item_id);
create index stage_logs_performed_by_idx on public.stage_logs(performed_by_user_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  seller_id uuid not null references public.sellers(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  payment_type text not null
    check (payment_type in ('downpayment','additional','balance')),
  proof_status text
    check (proof_status is null or proof_status in (
      'pending_verification','confirmed','rejected'
    )),
  proof_path text,
  rejection_reason text,
  confirmed_by_user_id uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create index payments_order_id_idx on public.payments(order_id);
create index payments_seller_id_idx on public.payments(seller_id);
create index payments_proof_status_idx on public.payments(proof_status);

create table public.order_event_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  old_event_id uuid references public.events(id) on delete set null,
  new_event_id uuid references public.events(id) on delete set null,
  reason text,
  changed_by_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index order_event_history_order_id_idx
on public.order_event_history(order_id);

create table public.event_change_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  original_event_date date,
  original_start_time time,
  original_end_time time,
  new_event_date date,
  new_start_time time,
  new_end_time time,
  reason text,
  changed_by_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index event_change_logs_event_id_idx
on public.event_change_logs(event_id);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  seller_id uuid not null references public.sellers(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  review_text text,
  created_at timestamptz not null default now()
);

create index reviews_seller_id_idx on public.reviews(seller_id);

create table public.sms_update_drafts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  triggered_by_user_id uuid references auth.users(id) on delete set null,
  message_text text not null,
  status text not null default 'ready'
    check (status in ('ready','dismissed','sent_marked')),
  created_at timestamptz not null default now(),
  sent_marked_at timestamptz
);

create index sms_update_drafts_seller_id_idx on public.sms_update_drafts(seller_id);
create index sms_update_drafts_order_id_idx on public.sms_update_drafts(order_id);

-- Auth -> Seller profile trigger
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_name text;
  method_name text;
  google_identifier text;
begin
  provider_name := coalesce(new.raw_app_meta_data ->> 'provider', 'email');

  method_name := case
    when provider_name = 'google' then 'google'
    else 'email'
  end;

  google_identifier := case
    when method_name = 'google'
    then new.raw_user_meta_data ->> 'sub'
    else null
  end;

  insert into public.sellers (
    id, email, login_method, google_id
  )
  values (
    new.id, new.email, method_name, google_identifier
  )
  on conflict (id) do update set
    email = excluded.email,
    login_method = excluded.login_method,
    google_id = coalesce(excluded.google_id, public.sellers.google_id),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

-- RLS
alter table public.sellers enable row level security;
alter table public.production_members enable row level security;
alter table public.products enable row level security;
alter table public.production_stages enable row level security;
alter table public.qr_codes enable row level security;
alter table public.customers enable row level security;
alter table public.events enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.stage_logs enable row level security;
alter table public.payments enable row level security;
alter table public.order_event_history enable row level security;
alter table public.event_change_logs enable row level security;
alter table public.reviews enable row level security;
alter table public.sms_update_drafts enable row level security;

revoke all on public.sellers from anon;
revoke all on public.production_members from anon;
revoke all on public.products from anon;
revoke all on public.production_stages from anon;
revoke all on public.qr_codes from anon;
revoke all on public.customers from anon;
revoke all on public.events from anon;
revoke all on public.orders from anon;
revoke all on public.order_items from anon;
revoke all on public.stage_logs from anon;
revoke all on public.payments from anon;
revoke all on public.order_event_history from anon;
revoke all on public.event_change_logs from anon;
revoke all on public.reviews from anon;
revoke all on public.sms_update_drafts from anon;

grant select, update on public.sellers to authenticated;
grant select, insert, update on public.production_members to authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert, update, delete on public.production_stages to authenticated;
grant select on public.qr_codes to authenticated;
grant select, insert, update on public.customers to authenticated;
grant select, insert, update on public.events to authenticated;
grant select, update on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select on public.stage_logs to authenticated;
grant select, insert, update on public.payments to authenticated;
grant select, insert on public.order_event_history to authenticated;
grant select, insert on public.event_change_logs to authenticated;
grant select on public.reviews to authenticated;
grant select, insert, update on public.sms_update_drafts to authenticated;

create policy "seller_select_own"
on public.sellers for select to authenticated
using (id = (select auth.uid()));

create policy "seller_update_own"
on public.sellers for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "member_select_own_shop"
on public.production_members for select to authenticated
using (seller_id = (select auth.uid()));

create policy "member_insert_own_shop"
on public.production_members for insert to authenticated
with check (seller_id = (select auth.uid()));

create policy "member_update_own_shop"
on public.production_members for update to authenticated
using (seller_id = (select auth.uid()))
with check (seller_id = (select auth.uid()));

create policy "product_select_own_shop"
on public.products for select to authenticated
using (seller_id = (select auth.uid()));

create policy "product_insert_own_shop"
on public.products for insert to authenticated
with check (seller_id = (select auth.uid()));

create policy "product_update_own_shop"
on public.products for update to authenticated
using (seller_id = (select auth.uid()))
with check (seller_id = (select auth.uid()));

create policy "stage_select_own_products"
on public.production_stages for select to authenticated
using (
  exists (
    select 1 from public.products p
    where p.id = production_stages.product_id
      and p.seller_id = (select auth.uid())
  )
);

create policy "stage_insert_own_products"
on public.production_stages for insert to authenticated
with check (
  exists (
    select 1 from public.products p
    where p.id = production_stages.product_id
      and p.seller_id = (select auth.uid())
  )
);

create policy "stage_update_own_products"
on public.production_stages for update to authenticated
using (
  exists (
    select 1 from public.products p
    where p.id = production_stages.product_id
      and p.seller_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.products p
    where p.id = production_stages.product_id
      and p.seller_id = (select auth.uid())
  )
);

create policy "stage_delete_own_products"
on public.production_stages for delete to authenticated
using (
  exists (
    select 1 from public.products p
    where p.id = production_stages.product_id
      and p.seller_id = (select auth.uid())
  )
);

create policy "qr_select_own"
on public.qr_codes for select to authenticated
using (seller_id = (select auth.uid()));

create policy "customer_select_own"
on public.customers for select to authenticated
using (seller_id = (select auth.uid()));

create policy "customer_insert_own"
on public.customers for insert to authenticated
with check (seller_id = (select auth.uid()));

create policy "customer_update_own"
on public.customers for update to authenticated
using (seller_id = (select auth.uid()))
with check (seller_id = (select auth.uid()));

create policy "event_select_own"
on public.events for select to authenticated
using (seller_id = (select auth.uid()));

create policy "event_insert_own"
on public.events for insert to authenticated
with check (seller_id = (select auth.uid()));

create policy "event_update_own"
on public.events for update to authenticated
using (seller_id = (select auth.uid()))
with check (seller_id = (select auth.uid()));

create policy "order_select_own"
on public.orders for select to authenticated
using (seller_id = (select auth.uid()));

create policy "order_update_own"
on public.orders for update to authenticated
using (seller_id = (select auth.uid()))
with check (seller_id = (select auth.uid()));

create policy "order_item_select_own"
on public.order_items for select to authenticated
using (seller_id = (select auth.uid()));

create policy "stage_log_select_own"
on public.stage_logs for select to authenticated
using (
  exists (
    select 1 from public.order_items oi
    where oi.id = stage_logs.order_item_id
      and oi.seller_id = (select auth.uid())
  )
);

create policy "payment_select_own"
on public.payments for select to authenticated
using (seller_id = (select auth.uid()));

create policy "payment_insert_own"
on public.payments for insert to authenticated
with check (seller_id = (select auth.uid()));

create policy "payment_update_own"
on public.payments for update to authenticated
using (seller_id = (select auth.uid()))
with check (seller_id = (select auth.uid()));

create policy "order_event_history_select_own"
on public.order_event_history for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_event_history.order_id
      and o.seller_id = (select auth.uid())
  )
);

create policy "order_event_history_insert_own"
on public.order_event_history for insert to authenticated
with check (
  exists (
    select 1 from public.orders o
    where o.id = order_event_history.order_id
      and o.seller_id = (select auth.uid())
  )
);

create policy "event_change_log_select_own"
on public.event_change_logs for select to authenticated
using (
  exists (
    select 1 from public.events e
    where e.id = event_change_logs.event_id
      and e.seller_id = (select auth.uid())
  )
);

create policy "event_change_log_insert_own"
on public.event_change_logs for insert to authenticated
with check (
  exists (
    select 1 from public.events e
    where e.id = event_change_logs.event_id
      and e.seller_id = (select auth.uid())
  )
);

create policy "review_select_own"
on public.reviews for select to authenticated
using (seller_id = (select auth.uid()));

create policy "sms_draft_select_own"
on public.sms_update_drafts for select to authenticated
using (seller_id = (select auth.uid()));

create policy "sms_draft_insert_own"
on public.sms_update_drafts for insert to authenticated
with check (seller_id = (select auth.uid()));

create policy "sms_draft_update_own"
on public.sms_update_drafts for update to authenticated
using (seller_id = (select auth.uid()))
with check (seller_id = (select auth.uid()));

-- Private storage buckets.
insert into storage.buckets (id,name,public)
values ('shop-logos','shop-logos',false)
on conflict (id) do update set public=false;

insert into storage.buckets (id,name,public)
values ('production-proofs','production-proofs',false)
on conflict (id) do update set public=false;

insert into storage.buckets (id,name,public)
values ('payment-proofs','payment-proofs',false)
on conflict (id) do update set public=false;

create policy "shop_logo_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id='shop-logos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create policy "shop_logo_select_own"
on storage.objects for select to authenticated
using (
  bucket_id='shop-logos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create policy "shop_logo_update_own"
on storage.objects for update to authenticated
using (
  bucket_id='shop-logos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
)
with check (
  bucket_id='shop-logos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create policy "shop_logo_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id='shop-logos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create policy "production_proof_select_own"
on storage.objects for select to authenticated
using (
  bucket_id='production-proofs'
  and exists (
    select 1
    from public.stage_logs sl
    join public.order_items oi on oi.id = sl.order_item_id
    where sl.proof_photo_path = storage.objects.name
      and oi.seller_id = (select auth.uid())
  )
);

create policy "production_proof_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id='production-proofs'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create policy "production_proof_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id='production-proofs'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create policy "payment_proof_select_own"
on storage.objects for select to authenticated
using (
  bucket_id='payment-proofs'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create policy "payment_proof_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id='payment-proofs'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create policy "payment_proof_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id='payment-proofs'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);
