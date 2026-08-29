-- ============================================================
-- 002_products.sql
-- Ordeli Master Prompt — Step 2: Product Catalog
-- Requires public.sellers from Step 1.
-- ============================================================

create table public.products (
  id uuid primary key default gen_random_uuid(),

  seller_id uuid not null
    references public.sellers(id)
    on delete cascade,

  name text not null,

  default_price numeric(12,2) not null default 0,

  customer_cancellable_until_stage integer,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  constraint products_name_not_blank
    check (length(trim(name)) > 0),

  constraint products_price_non_negative
    check (default_price >= 0),

  constraint products_cancel_stage_positive
    check (
      customer_cancellable_until_stage is null
      or customer_cancellable_until_stage > 0
    )
);

create index products_seller_id_idx
on public.products(seller_id);

create index products_seller_active_idx
on public.products(seller_id, is_active);

create trigger products_set_updated_at
before update on public.products
for each row
execute function public.set_updated_at();

alter table public.products
enable row level security;

revoke all on public.products from anon;

grant select, insert, update
on public.products
to authenticated;

create policy "Products sellers can view own"
on public.products
for select
to authenticated
using (
  seller_id = (select auth.uid())
);

create policy "Products sellers can create own"
on public.products
for insert
to authenticated
with check (
  seller_id = (select auth.uid())
);

create policy "Products sellers can update own"
on public.products
for update
to authenticated
using (
  seller_id = (select auth.uid())
)
with check (
  seller_id = (select auth.uid())
);
