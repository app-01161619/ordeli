create table public.products (
  id uuid not null default gen_random_uuid (),
  seller_id uuid not null,
  name text not null,
  default_price numeric(12, 2) not null default 0,
  customer_cancellable_until_stage integer null,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint products_pkey primary key (id),
  constraint products_seller_id_fkey foreign KEY (seller_id) references sellers (id) on delete CASCADE,
  constraint products_customer_cancellable_until_stage_check check (
    (
      (customer_cancellable_until_stage is null)
      or (customer_cancellable_until_stage > 0)
    )
  ),
  constraint products_default_price_check check ((default_price >= (0)::numeric)),
  constraint products_default_price_nonnegative check ((default_price >= (0)::numeric)) not VALID,
  constraint products_name_check check (
    (
      length(
        TRIM(
          both
          from
            name
        )
      ) > 0
    )
  )
) TABLESPACE pg_default;

create index IF not exists products_seller_id_idx on public.products using btree (seller_id) TABLESPACE pg_default;

create index IF not exists idx_products_seller_id_active on public.products using btree (seller_id, is_active) TABLESPACE pg_default;

create trigger products_set_updated_at BEFORE
update on products for EACH row
execute FUNCTION set_updated_at ();