-- ============================================================
-- 006_orders.sql
-- Ordeli
--
-- Seller Order Creation
--
-- This migration creates:
--   orders
--   order_items
--   order_item_production_stages
--
-- It also creates a secure RPC for creating an entire order
-- atomically.
-- ============================================================


-- ============================================================
-- 1. ORDERS
-- ============================================================

create table if not exists public.orders (

    id uuid primary key default gen_random_uuid(),

    seller_id uuid not null
        references auth.users(id)
        on delete cascade,

    order_number bigint generated always as identity,

    customer_name text not null,

    customer_phone text,

    total_amount numeric(12, 2) not null default 0,

    status text not null default 'active',

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint orders_customer_name_not_blank
        check (length(trim(customer_name)) > 0),

    constraint orders_total_non_negative
        check (total_amount >= 0),

    constraint orders_status_valid
        check (
            status in (
                'active',
                'cancelled'
            )
        )

);


create index if not exists orders_seller_id_idx
on public.orders(seller_id);


create index if not exists orders_created_at_idx
on public.orders(created_at);


-- ============================================================
-- 2. ORDER ITEMS
-- ============================================================

create table if not exists public.order_items (

    id uuid primary key default gen_random_uuid(),

    order_id uuid not null
        references public.orders(id)
        on delete cascade,

    seller_id uuid not null
        references auth.users(id)
        on delete cascade,

    product_id uuid not null
        references public.products(id)
        on delete restrict,

    qr_code_id uuid not null
        references public.qr_codes(id)
        on delete restrict,

    product_name text not null,

    quantity integer not null,

    unit_price numeric(12, 2) not null,

    total_price numeric(12, 2) not null,

    created_at timestamptz not null default now(),

    constraint order_items_quantity_positive
        check (quantity > 0),

    constraint order_items_unit_price_non_negative
        check (unit_price >= 0),

    constraint order_items_total_price_non_negative
        check (total_price >= 0),

    constraint order_items_qr_unique
        unique (qr_code_id)

);


create index if not exists order_items_order_id_idx
on public.order_items(order_id);


create index if not exists order_items_seller_id_idx
on public.order_items(seller_id);


create index if not exists order_items_product_id_idx
on public.order_items(product_id);


-- ============================================================
-- 3. ORDER ITEM PRODUCTION STAGES
-- ============================================================
--
-- These are snapshots of the product workflow at the moment
-- the order is created.
--
-- Later, the actual production execution records can be
-- attached to these fixed stages.
--
-- Changing a product workflow later will NOT alter these
-- historical stages.
-- ============================================================

create table if not exists public.order_item_production_stages (

    id uuid primary key default gen_random_uuid(),

    order_item_id uuid not null
        references public.order_items(id)
        on delete cascade,

    stage_name text not null,

    stage_order integer not null,

    created_at timestamptz not null default now(),

    constraint order_item_stage_name_not_blank
        check (
            length(trim(stage_name)) > 0
        ),

    constraint order_item_stage_order_positive
        check (
            stage_order > 0
        ),

    constraint order_item_stage_order_unique
        unique (
            order_item_id,
            stage_order
        )

);


create index
if not exists
order_item_production_stages_item_id_idx
on public.order_item_production_stages(
    order_item_id
);


-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================

alter table public.orders
enable row level security;

alter table public.order_items
enable row level security;

alter table public.order_item_production_stages
enable row level security;


-- ============================================================
-- 5. GRANTS
-- ============================================================

revoke all
on public.orders
from anon;


revoke all
on public.order_items
from anon;


revoke all
on public.order_item_production_stages
from anon;


grant select
on public.orders
to authenticated;


grant select
on public.order_items
to authenticated;


grant select
on public.order_item_production_stages
to authenticated;


-- ============================================================
-- 6. ORDER POLICIES
-- ============================================================

drop policy if exists
"Sellers can view own orders"
on public.orders;


create policy
"Sellers can view own orders"
on public.orders
for select
to authenticated
using (
    (select auth.uid()) = seller_id
);


-- ============================================================
-- 7. ORDER ITEM POLICIES
-- ============================================================

drop policy if exists
"Sellers can view own order items"
on public.order_items;


create policy
"Sellers can view own order items"
on public.order_items
for select
to authenticated
using (
    (select auth.uid()) = seller_id
);


-- ============================================================
-- 8. PRODUCTION SNAPSHOT POLICIES
-- ============================================================

drop policy if exists
"Sellers can view own order item stages"
on public.order_item_production_stages;


create policy
"Sellers can view own order item stages"
on public.order_item_production_stages
for select
to authenticated
using (

    exists (

        select 1

        from public.order_items

        where
            order_items.id =
                order_item_production_stages.order_item_id

            and
            order_items.seller_id =
                auth.uid()

    )

);


-- ============================================================
-- 9. CREATE ORDER RPC
-- ============================================================
--
-- requested_items is a JSON array like:
--
-- [
--   {
--     "product_id": "...",
--     "quantity": 6,
--     "unit_price": 100,
--     "qr_code_id": "..."
--   }
-- ]
--
-- Everything is created in one database transaction.
--
-- This prevents:
--
--   Order created
--   but item missing
--   or QR assigned incorrectly
--   or workflow snapshot missing
--
-- ============================================================

create or replace function public.create_order(

    requested_customer_name text,

    requested_customer_phone text,

    requested_items jsonb

)

returns uuid

language plpgsql

security definer

set search_path = public

as $$

declare

    current_seller_id uuid;

    new_order_id uuid;

    current_order_number bigint;

    requested_item jsonb;

    requested_product_id uuid;

    requested_qr_id uuid;

    requested_quantity integer;

    requested_unit_price numeric(12, 2);

    product_record public.products%rowtype;

    qr_record public.qr_codes%rowtype;

    item_id uuid;

    item_total numeric(12, 2);

    order_total numeric(12, 2) := 0;

    stage_record public.production_stages%rowtype;

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
    -- CUSTOMER
    -- ========================================================

    if
        requested_customer_name is null
        or length(
            trim(requested_customer_name)
        ) = 0
    then

        raise exception
            'Customer name is required';

    end if;


    -- ========================================================
    -- ITEMS
    -- ========================================================

    if
        requested_items is null
        or jsonb_typeof(
            requested_items
        ) <> 'array'
        or jsonb_array_length(
            requested_items
        ) = 0
    then

        raise exception
            'At least one order item is required';

    end if;


    -- ========================================================
    -- CREATE ORDER
    -- ========================================================

    insert into public.orders (

        seller_id,

        customer_name,

        customer_phone

    )

    values (

        current_seller_id,

        trim(
            requested_customer_name
        ),

        nullif(
            trim(
                requested_customer_phone
            ),
            ''
        )

    )

    returning
        id,
        order_number

    into
        new_order_id,
        current_order_number;


    -- ========================================================
    -- PROCESS ITEMS
    -- ========================================================

    for requested_item in
        select *
        from jsonb_array_elements(
            requested_items
        )
    loop

        requested_product_id :=
            (requested_item ->>
                'product_id')::uuid;


        requested_qr_id :=
            (requested_item ->>
                'qr_code_id')::uuid;


        requested_quantity :=
            (requested_item ->>
                'quantity')::integer;


        requested_unit_price :=
            (requested_item ->>
                'unit_price')::numeric;


        -- ----------------------------------------------------
        -- VALIDATE QUANTITY
        -- ----------------------------------------------------

        if
            requested_quantity is null
            or requested_quantity <= 0
        then

            raise exception
                'Quantity must be greater than zero';

        end if;


        -- ----------------------------------------------------
        -- VALIDATE PRICE
        -- ----------------------------------------------------

        if
            requested_unit_price is null
            or requested_unit_price < 0
        then

            raise exception
                'Unit price must not be negative';

        end if;


        -- ----------------------------------------------------
        -- LOAD PRODUCT
        -- ----------------------------------------------------

        select *
        into product_record
        from public.products
        where
            products.id =
                requested_product_id
            and
            products.seller_id =
                current_seller_id
        for update;


        if not found then

            raise exception
                'Product not found';

        end if;


        -- ----------------------------------------------------
        -- LOAD QR
        -- ----------------------------------------------------

        select *
        into qr_record
        from public.qr_codes
        where
            qr_codes.id =
                requested_qr_id
            and
            qr_codes.seller_id =
                current_seller_id
        for update;


        if not found then

            raise exception
                'QR code not found';

        end if;


        -- ----------------------------------------------------
        -- VALIDATE QR STATUS
        -- ----------------------------------------------------

        if qr_record.status <>
            'available'
        then

            raise exception
                'Selected QR code is not available';

        end if;


        -- ----------------------------------------------------
        -- VALIDATE QR PRODUCT
        -- ----------------------------------------------------

        if qr_record.product_id <>
            requested_product_id
        then

            raise exception
                'QR code belongs to a different product';

        end if;


        -- ----------------------------------------------------
        -- CALCULATE ITEM TOTAL
        -- ----------------------------------------------------

        item_total :=
            round(
                requested_quantity *
                requested_unit_price,
                2
            );


        -- ----------------------------------------------------
        -- CREATE ORDER ITEM
        -- ----------------------------------------------------

        insert into public.order_items (

            order_id,

            seller_id,

            product_id,

            qr_code_id,

            product_name,

            quantity,

            unit_price,

            total_price

        )

        values (

            new_order_id,

            current_seller_id,

            product_record.id,

            qr_record.id,

            product_record.name,

            requested_quantity,

            requested_unit_price,

            item_total

        )

        returning id
        into item_id;


        -- ----------------------------------------------------
        -- SNAPSHOT WORKFLOW
        -- ----------------------------------------------------

        for stage_record in

            select *
            from public.production_stages

            where
                production_stages.product_id =
                    requested_product_id

            order by
                stage_order asc

        loop

            insert into
                public.order_item_production_stages (

                    order_item_id,

                    stage_name,

                    stage_order

                )

            values (

                item_id,

                stage_record.name,

                stage_record.stage_order

            );

        end loop;


        -- ----------------------------------------------------
        -- ASSIGN QR
        -- ----------------------------------------------------

        update public.qr_codes

        set
            status = 'assigned'

        where
            id = qr_record.id;


        -- ----------------------------------------------------
        -- ADD TO ORDER TOTAL
        -- ----------------------------------------------------

        order_total :=
            order_total +
            item_total;

    end loop;


    -- ========================================================
    -- UPDATE ORDER TOTAL
    -- ========================================================

    update public.orders

    set
        total_amount =
            order_total,

        updated_at =
            now()

    where
        id =
            new_order_id;


    return new_order_id;

end;

$$;


-- ============================================================
-- 10. FUNCTION PERMISSIONS
-- ============================================================

revoke all
on function public.create_order(
    text,
    text,
    jsonb
)
from public;


grant execute
on function public.create_order(
    text,
    text,
    jsonb
)
to authenticated;


-- ============================================================
-- END
-- ============================================================