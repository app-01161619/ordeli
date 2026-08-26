-- ============================================================
-- 005_qr_management.sql
-- Ordeli
--
-- QR Series & QR Inventory
--
-- This migration creates:
--   1. qr_series
--   2. qr_codes
--   3. Row Level Security policies
--   4. QR series generation function
--
-- Business rules:
--   - A QR belongs to one product type.
--   - QR quantity is independent from order quantity.
--   - A QR represents one future order item.
--   - QR status is tracked independently.
--   - Public tracking uses an unpredictable token.
-- ============================================================


-- ============================================================
-- 1. QR SERIES
-- ============================================================

create table if not exists public.qr_series (

    id uuid primary key default gen_random_uuid(),

    seller_id uuid not null
        references auth.users(id)
        on delete cascade,

    product_id uuid not null
        references public.products(id)
        on delete restrict,

    series_name text not null,

    quantity integer not null,

    created_at timestamptz not null default now(),

    constraint qr_series_name_not_blank
        check (length(trim(series_name)) > 0),

    constraint qr_series_quantity_positive
        check (quantity > 0)

);


-- ============================================================
-- QR SERIES INDEXES
-- ============================================================

create index if not exists qr_series_seller_id_idx
on public.qr_series(seller_id);


create index if not exists qr_series_product_id_idx
on public.qr_series(product_id);


-- ============================================================
-- 2. QR CODES
-- ============================================================

create table if not exists public.qr_codes (

    id uuid primary key default gen_random_uuid(),

    series_id uuid not null
        references public.qr_series(id)
        on delete restrict,

    seller_id uuid not null
        references auth.users(id)
        on delete cascade,

    product_id uuid not null
        references public.products(id)
        on delete restrict,

    -- Internal physical QR inventory identifier.
    code text not null unique,

    -- Secure public token used later by customer tracking.
    public_token text not null unique,

    status text not null default 'available',

    created_at timestamptz not null default now(),

    constraint qr_codes_status_valid
        check (
            status in (
                'available',
                'assigned',
                'released',
                'revoked'
            )
        )

);


-- ============================================================
-- QR CODE INDEXES
-- ============================================================

create index if not exists qr_codes_series_id_idx
on public.qr_codes(series_id);


create index if not exists qr_codes_seller_id_idx
on public.qr_codes(seller_id);


create index if not exists qr_codes_product_id_idx
on public.qr_codes(product_id);


create index if not exists qr_codes_status_idx
on public.qr_codes(status);


-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================

alter table public.qr_series
enable row level security;


alter table public.qr_codes
enable row level security;


-- ============================================================
-- 4. TABLE GRANTS
-- ============================================================

revoke all
on public.qr_series
from anon;


revoke all
on public.qr_codes
from anon;


grant select, insert
on public.qr_series
to authenticated;


grant select
on public.qr_codes
to authenticated;


-- ============================================================
-- 5. QR SERIES POLICIES
-- ============================================================

drop policy if exists
"Sellers can view own QR series"
on public.qr_series;


create policy
"Sellers can view own QR series"
on public.qr_series
for select
to authenticated
using (
    (select auth.uid()) = seller_id
);


drop policy if exists
"Sellers can create own QR series"
on public.qr_series;


create policy
"Sellers can create own QR series"
on public.qr_series
for insert
to authenticated
with check (
    (select auth.uid()) = seller_id
);


-- ============================================================
-- 6. QR CODE POLICIES
-- ============================================================

drop policy if exists
"Sellers can view own QR codes"
on public.qr_codes;


create policy
"Sellers can view own QR codes"
on public.qr_codes
for select
to authenticated
using (
    (select auth.uid()) = seller_id
);


-- ============================================================
-- 7. GENERATE QR SERIES
-- ============================================================
--
-- This function:
--
--   1. Verifies the seller is authenticated.
--   2. Verifies the requested product belongs to the seller.
--   3. Creates the QR series.
--   4. Creates the requested number of QR records.
--
-- The browser never supplies seller_id.
-- The function obtains it from auth.uid().
--
-- We intentionally use gen_random_uuid() for the
-- unpredictable public tracking token instead of
-- gen_random_bytes().
-- ============================================================

create or replace function public.create_qr_series(

    requested_product_id uuid,

    requested_series_name text,

    requested_quantity integer

)
returns uuid

language plpgsql

security definer

set search_path = public

as $$

declare

    current_seller_id uuid;

    new_series_id uuid;

    product_exists boolean;

    current_number integer;

    generated_code text;

    generated_token text;

begin


    -- ========================================================
    -- AUTHENTICATION
    -- ========================================================

    current_seller_id :=
        auth.uid();


    if current_seller_id is null then

        raise exception
            'Authentication required';

    end if;


    -- ========================================================
    -- VALIDATE SERIES NAME
    -- ========================================================

    if
        requested_series_name is null
        or length(
            trim(requested_series_name)
        ) = 0
    then

        raise exception
            'Series name is required';

    end if;


    -- ========================================================
    -- VALIDATE QUANTITY
    -- ========================================================

    if requested_quantity is null then

        raise exception
            'Quantity is required';

    end if;


    if requested_quantity <= 0 then

        raise exception
            'Quantity must be greater than zero';

    end if;


    /*
     * Limit batch size for safety.
     *
     * This can be changed later if the business
     * requires larger batches.
     */

    if requested_quantity > 5000 then

        raise exception
            'Maximum batch size is 5000';

    end if;


    -- ========================================================
    -- VERIFY PRODUCT OWNERSHIP
    -- ========================================================

    select exists (

        select 1

        from public.products

        where
            products.id =
                requested_product_id

            and
            products.seller_id =
                current_seller_id

    )

    into product_exists;


    if not product_exists then

        raise exception
            'Product not found';

    end if;


    -- ========================================================
    -- CREATE SERIES
    -- ========================================================

    insert into public.qr_series (

        seller_id,

        product_id,

        series_name,

        quantity

    )

    values (

        current_seller_id,

        requested_product_id,

        trim(
            requested_series_name
        ),

        requested_quantity

    )

    returning id

    into new_series_id;


    -- ========================================================
    -- CREATE QR RECORDS
    -- ========================================================

    for current_number in
        1..requested_quantity
    loop


        /*
         * Internal QR identifier.
         *
         * Example:
         * QR-4F7C9A...
         */

        generated_code :=
            'QR-' ||
            upper(
                replace(
                    gen_random_uuid()::text,
                    '-',
                    ''
                )
            );


        /*
         * Customer-facing secure token.
         *
         * Two UUIDs are combined to create a
         * long, unpredictable value.
         */

        generated_token :=
            replace(
                gen_random_uuid()::text ||
                gen_random_uuid()::text,
                '-',
                ''
            );


        insert into public.qr_codes (

            series_id,

            seller_id,

            product_id,

            code,

            public_token,

            status

        )

        values (

            new_series_id,

            current_seller_id,

            requested_product_id,

            generated_code,

            generated_token,

            'available'

        );


    end loop;


    -- ========================================================
    -- RETURN SERIES ID
    -- ========================================================

    return new_series_id;


end;

$$;


-- ============================================================
-- 8. FUNCTION PERMISSION
-- ============================================================

revoke all
on function public.create_qr_series(
    uuid,
    text,
    integer
)
from public;


grant execute
on function public.create_qr_series(
    uuid,
    text,
    integer
)
to authenticated;


-- ============================================================
-- END OF 005_qr_management.sql
-- ============================================================