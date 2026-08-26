-- ============================================
-- QR SERIES
-- ============================================

create table public.qr_series (
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


create index qr_series_seller_id_idx
on public.qr_series(seller_id);


create index qr_series_product_id_idx
on public.qr_series(product_id);


-- ============================================
-- QR CODES
-- ============================================

create table public.qr_codes (
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

    code text not null unique,

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


create index qr_codes_series_id_idx
on public.qr_codes(series_id);


create index qr_codes_seller_id_idx
on public.qr_codes(seller_id);


create index qr_codes_product_id_idx
on public.qr_codes(product_id);


create index qr_codes_status_idx
on public.qr_codes(status);


-- ============================================
-- RLS
-- ============================================

alter table public.qr_series
enable row level security;

alter table public.qr_codes
enable row level security;


grant select, insert
on public.qr_series
to authenticated;


grant select
on public.qr_codes
to authenticated;


-- ============================================
-- QR SERIES POLICIES
-- ============================================

create policy "Sellers can view own QR series"
on public.qr_series
for select
to authenticated
using (
    (select auth.uid()) = seller_id
);


create policy "Sellers can create own QR series"
on public.qr_series
for insert
to authenticated
with check (
    (select auth.uid()) = seller_id
);


-- ============================================
-- QR CODE POLICIES
-- ============================================

create policy "Sellers can view own QR codes"
on public.qr_codes
for select
to authenticated
using (
    (select auth.uid()) = seller_id
);

-- ============================================
-- GENERATE QR SERIES
-- ============================================

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
begin

    current_seller_id := auth.uid();

    if current_seller_id is null then
        raise exception 'Authentication required';
    end if;


    if length(trim(requested_series_name)) = 0 then
        raise exception 'Series name is required';
    end if;


    if requested_quantity <= 0 then
        raise exception 'Quantity must be greater than zero';
    end if;


    if requested_quantity > 5000 then
        raise exception 'Maximum batch size is 5000';
    end if;


    select exists (
        select 1
        from public.products
        where id = requested_product_id
          and seller_id = current_seller_id
    )
    into product_exists;


    if not product_exists then
        raise exception 'Product not found';
    end if;


    insert into public.qr_series (
        seller_id,
        product_id,
        series_name,
        quantity
    )
    values (
        current_seller_id,
        requested_product_id,
        trim(requested_series_name),
        requested_quantity
    )
    returning id
    into new_series_id;


    for current_number in 1..requested_quantity loop

        insert into public.qr_codes (
            series_id,
            seller_id,
            product_id,
            code,
            public_token
        )
        values (
            new_series_id,
            current_seller_id,
            requested_product_id,
            'QR-' || upper(replace(gen_random_uuid()::text, '-', '')),
            replace(
                encode(gen_random_bytes(24), 'base64'),
                '/',
                '_'
            )
        );

    end loop;


    return new_series_id;

end;
$$;


grant execute
on function public.create_qr_series(
    uuid,
    text,
    integer
)
to authenticated;