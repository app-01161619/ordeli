-- ============================================
-- PRODUCTS
-- ============================================

create table public.products (
    id uuid primary key default gen_random_uuid(),

    seller_id uuid not null
        references auth.users(id)
        on delete cascade,

    name text not null,

    default_price numeric(12, 2) not null default 0,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint products_name_not_blank
        check (length(trim(name)) > 0),

    constraint products_default_price_non_negative
        check (default_price >= 0)
);


-- ============================================
-- INDEX
-- ============================================

create index products_seller_id_idx
on public.products(seller_id);


-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

alter table public.products
enable row level security;


-- ============================================
-- PERMISSIONS
-- ============================================

revoke all
on table public.products
from anon;

grant select, insert, update
on table public.products
to authenticated;


-- ============================================
-- SELECT
-- ============================================

create policy "Sellers can view own products"
on public.products
for select
to authenticated
using (
    (select auth.uid()) = seller_id
);


-- ============================================
-- INSERT
-- ============================================

create policy "Sellers can create own products"
on public.products
for insert
to authenticated
with check (
    (select auth.uid()) = seller_id
);


-- ============================================
-- UPDATE
-- ============================================

create policy "Sellers can update own products"
on public.products
for update
to authenticated
using (
    (select auth.uid()) = seller_id
)
with check (
    (select auth.uid()) = seller_id
);