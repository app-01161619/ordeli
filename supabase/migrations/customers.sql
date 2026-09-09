create table public.customers (
  id uuid not null default gen_random_uuid (),
  seller_id uuid not null,
  name text not null,
  phone text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint customers_pkey primary key (id),
  constraint customers_seller_id_fkey foreign KEY (seller_id) references sellers (id) on delete CASCADE,
  constraint customers_name_check check (
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

create index IF not exists customers_seller_id_idx on public.customers using btree (seller_id) TABLESPACE pg_default;

create index IF not exists customers_seller_phone_idx on public.customers using btree (seller_id, phone) TABLESPACE pg_default;

create index IF not exists idx_customers_seller_name on public.customers using btree (seller_id, name) TABLESPACE pg_default;

create trigger customers_set_updated_at BEFORE
update on customers for EACH row
execute FUNCTION set_updated_at ();