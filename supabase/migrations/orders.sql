    create table public.orders (
  id uuid not null default gen_random_uuid (),
  seller_id uuid not null,
  customer_id uuid not null,
  order_number bigint generated always as identity not null,
  fulfillment_type text not null default 'not_selected'::text,
  event_id uuid null,
  pickup_status text not null default 'not_scheduled'::text,
  handed_over_at timestamp with time zone null,
  cancelled_at timestamp with time zone null,
  cancel_reason text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint orders_pkey primary key (id),
  constraint orders_customer_id_fkey foreign KEY (customer_id) references customers (id) on delete RESTRICT,
  constraint orders_event_id_fkey foreign KEY (event_id) references events (id) on delete RESTRICT,
  constraint orders_seller_id_fkey foreign KEY (seller_id) references sellers (id) on delete CASCADE,
  constraint orders_fulfillment_type_check check (
    (
      fulfillment_type = any (
        array[
          'not_selected'::text,
          'shop'::text,
          'location'::text,
          'courier'::text
        ]
      )
    )
  ),
  constraint orders_pickup_status_check check (
    (
      pickup_status = any (
        array[
          'not_scheduled'::text,
          'scheduled'::text,
          'bring_to_event'::text,
          'unclaimed'::text,
          'rescheduled'::text,
          'handed_over'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create unique INDEX IF not exists orders_seller_order_number_unique on public.orders using btree (seller_id, order_number) TABLESPACE pg_default;

create index IF not exists orders_seller_id_idx on public.orders using btree (seller_id) TABLESPACE pg_default;

create index IF not exists orders_customer_id_idx on public.orders using btree (customer_id) TABLESPACE pg_default;

create index IF not exists orders_event_id_idx on public.orders using btree (event_id) TABLESPACE pg_default;

create index IF not exists orders_created_at_idx on public.orders using btree (created_at) TABLESPACE pg_default;

create index IF not exists idx_orders_seller_created on public.orders using btree (seller_id, created_at desc) TABLESPACE pg_default;

create index IF not exists idx_orders_seller_event on public.orders using btree (seller_id, event_id) TABLESPACE pg_default
where
  (event_id is not null);

create trigger orders_set_updated_at BEFORE
update on orders for EACH row
execute FUNCTION set_updated_at ();

create trigger trg_order_pickup_sms_update
after
update OF event_id,
pickup_status on orders for EACH row
execute FUNCTION trg_order_pickup_sms_update ();