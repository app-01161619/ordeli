create table public.qr_codes (
  id uuid not null default gen_random_uuid (),
  seller_id uuid not null,
  product_id uuid not null,
  code text not null,
  public_token text not null,
  status text not null default 'available'::text,
  order_item_id uuid null,
  assigned_at timestamp with time zone null,
  revoked_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  series_name text null,
  series_sequence integer null,
  constraint qr_codes_pkey primary key (id),
  constraint qr_codes_code_key unique (code),
  constraint qr_codes_public_token_key unique (public_token),
  constraint qr_codes_product_id_fkey foreign KEY (product_id) references products (id) on delete RESTRICT,
  constraint qr_codes_order_item_fk foreign KEY (order_item_id) references order_items (id) on delete RESTRICT,
  constraint qr_codes_seller_id_fkey foreign KEY (seller_id) references sellers (id) on delete CASCADE,
  constraint qr_codes_status_check check (
    (
      status = any (
        array[
          'available'::text,
          'assigned'::text,
          'revoked'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists qr_codes_seller_id_idx on public.qr_codes using btree (seller_id) TABLESPACE pg_default;

create index IF not exists qr_codes_product_id_idx on public.qr_codes using btree (product_id) TABLESPACE pg_default;

create index IF not exists qr_codes_status_idx on public.qr_codes using btree (status) TABLESPACE pg_default;

create index IF not exists qr_codes_order_item_id_idx on public.qr_codes using btree (order_item_id) TABLESPACE pg_default;

create unique INDEX IF not exists qr_codes_assigned_order_item_unique on public.qr_codes using btree (order_item_id) TABLESPACE pg_default
where
  (
    (order_item_id is not null)
    and (status = 'assigned'::text)
  );

create unique INDEX IF not exists qr_codes_product_sequence_unique on public.qr_codes using btree (product_id, series_sequence) TABLESPACE pg_default
where
  (series_sequence is not null);

create index IF not exists qr_codes_series_idx on public.qr_codes using btree (seller_id, product_id, series_name) TABLESPACE pg_default;

create index IF not exists idx_qr_codes_seller_status on public.qr_codes using btree (seller_id, status) TABLESPACE pg_default;

create index IF not exists idx_qr_codes_product_status on public.qr_codes using btree (product_id, status) TABLESPACE pg_default;

create index IF not exists idx_qr_codes_order_item_id on public.qr_codes using btree (order_item_id) TABLESPACE pg_default
where
  (order_item_id is not null);

create unique INDEX IF not exists uq_qr_codes_assigned_order_item on public.qr_codes using btree (order_item_id) TABLESPACE pg_default
where
  (order_item_id is not null);