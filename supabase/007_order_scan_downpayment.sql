-- ============================================================
-- 007_order_scan_downpayment.sql
-- Ordeli
--
-- Changes the order-entry flow to QR-first:
--   available QR -> create order
--   assigned QR  -> open existing order
--
-- Adds seller-recorded downpayments through payments.
-- Existing 006 orders/order_items tables are reused.
-- ============================================================

create table if not exists public.payments (
    id uuid primary key default gen_random_uuid(),

    order_id uuid not null
        references public.orders(id)
        on delete restrict,

    seller_id uuid not null
        references auth.users(id)
        on delete cascade,

    amount numeric(12,2) not null,

    payment_type text not null default 'downpayment',

    status text not null default 'confirmed',

    note text,

    created_at timestamptz not null default now(),

    constraint payments_amount_positive
        check (amount > 0),

    constraint payments_type_valid
        check (
            payment_type in (
                'downpayment',
                'additional',
                'final'
            )
        ),

    constraint payments_status_valid
        check (
            status in (
                'confirmed',
                'pending_verification',
                'rejected'
            )
        )
);

create index if not exists payments_order_id_idx
on public.payments(order_id);

create index if not exists payments_seller_id_idx
on public.payments(seller_id);

alter table public.payments enable row level security;

revoke all on public.payments from anon;
grant select on public.payments to authenticated;

drop policy if exists "Sellers can view own payments" on public.payments;
create policy "Sellers can view own payments"
on public.payments
for select
to authenticated
using ((select auth.uid()) = seller_id);

-- ============================================================
-- CREATE ORDER FROM SCANNED QR
-- ============================================================

create or replace function public.create_order_from_scanned_qr(
    requested_qr_code_id uuid,
    requested_customer_name text,
    requested_customer_phone text,
    requested_quantity integer,
    requested_downpayment numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    current_seller_id uuid;
    new_order_id uuid;
    new_order_item_id uuid;
    qr_record public.qr_codes%rowtype;
    product_record public.products%rowtype;
    stage_record public.production_stages%rowtype;
    order_total numeric(12,2);
begin
    current_seller_id := auth.uid();

    if current_seller_id is null then
        raise exception 'Authentication required';
    end if;

    if requested_customer_name is null
       or length(trim(requested_customer_name)) = 0 then
        raise exception 'Customer name is required';
    end if;

    if requested_quantity is null
       or requested_quantity <= 0 then
        raise exception 'Quantity must be greater than zero';
    end if;

    if requested_downpayment is null
       or requested_downpayment < 0 then
        raise exception 'Downpayment must not be negative';
    end if;

    select *
    into qr_record
    from public.qr_codes
    where id = requested_qr_code_id
      and seller_id = current_seller_id
    for update;

    if not found then
        raise exception 'QR code not found';
    end if;

    if qr_record.status <> 'available' then
        raise exception 'QR code is no longer available for a new order';
    end if;

    select *
    into product_record
    from public.products
    where id = qr_record.product_id
      and seller_id = current_seller_id;

    if not found then
        raise exception 'Product not found';
    end if;

    order_total := round(
        requested_quantity * product_record.default_price,
        2
    );

    if requested_downpayment > order_total then
        raise exception 'Downpayment cannot be greater than the order total';
    end if;

    insert into public.orders (
        seller_id,
        customer_name,
        customer_phone,
        total_amount,
        status
    )
    values (
        current_seller_id,
        trim(requested_customer_name),
        nullif(trim(requested_customer_phone), ''),
        order_total,
        'active'
    )
    returning id into new_order_id;

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
        product_record.default_price,
        order_total
    )
    returning id into new_order_item_id;

    for stage_record in
        select *
        from public.production_stages
        where product_id = product_record.id
        order by stage_order asc
    loop
        insert into public.order_item_production_stages (
            order_item_id,
            stage_name,
            stage_order
        )
        values (
            new_order_item_id,
            stage_record.name,
            stage_record.stage_order
        );
    end loop;

    update public.qr_codes
    set status = 'assigned'
    where id = qr_record.id;

    if requested_downpayment > 0 then
        insert into public.payments (
            order_id,
            seller_id,
            amount,
            payment_type,
            status
        )
        values (
            new_order_id,
            current_seller_id,
            requested_downpayment,
            'downpayment',
            'confirmed'
        );
    end if;

    return new_order_id;
end;
$$;

revoke all on function public.create_order_from_scanned_qr(
    uuid,
    text,
    text,
    integer,
    numeric
) from public;

grant execute on function public.create_order_from_scanned_qr(
    uuid,
    text,
    text,
    integer,
    numeric
) to authenticated;
