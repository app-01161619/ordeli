-- ============================================
-- PRODUCTION STAGES
-- ============================================

create table public.production_stages (
    id uuid primary key default gen_random_uuid(),

    product_id uuid not null
        references public.products(id)
        on delete cascade,

    name text not null,

    stage_order integer not null,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint production_stages_name_not_blank
        check (length(trim(name)) > 0),

    constraint production_stages_order_positive
        check (stage_order > 0),

    constraint production_stages_product_order_unique
        unique (product_id, stage_order)
);


-- ============================================
-- INDEX
-- ============================================

create index production_stages_product_id_idx
on public.production_stages(product_id);


-- ============================================
-- RLS
-- ============================================

alter table public.production_stages
enable row level security;


grant select, insert, update, delete
on public.production_stages
to authenticated;


-- ============================================
-- HELPER:
-- PRODUCT MUST BELONG TO CURRENT SELLER
-- ============================================

create or replace function public.product_belongs_to_current_seller(
    requested_product_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select exists (
        select 1
        from public.products
        where products.id = requested_product_id
          and products.seller_id = auth.uid()
    );
$$;


-- ============================================
-- SELECT
-- ============================================

create policy "Sellers can view own production stages"
on public.production_stages
for select
to authenticated
using (
    public.product_belongs_to_current_seller(
        product_id
    )
);


-- ============================================
-- INSERT
-- ============================================

create policy "Sellers can create own production stages"
on public.production_stages
for insert
to authenticated
with check (
    public.product_belongs_to_current_seller(
        product_id
    )
);


-- ============================================
-- UPDATE
-- ============================================

create policy "Sellers can update own production stages"
on public.production_stages
for update
to authenticated
using (
    public.product_belongs_to_current_seller(
        product_id
    )
)
with check (
    public.product_belongs_to_current_seller(
        product_id
    )
);


-- ============================================
-- DELETE
-- ============================================

create policy "Sellers can delete own production stages"
on public.production_stages
for delete
to authenticated
using (
    public.product_belongs_to_current_seller(
        product_id
    )
);