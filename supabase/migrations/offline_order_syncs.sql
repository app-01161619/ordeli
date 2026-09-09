create table public.offline_order_syncs (
  seller_id uuid not null,
  device_id text not null,
  client_order_id text not null,
  order_id uuid not null,
  synced_at timestamp with time zone not null default now(),
  constraint offline_order_syncs_pkey primary key (seller_id, client_order_id),
  constraint offline_order_syncs_order_id_fkey foreign KEY (order_id) references orders (id) on delete CASCADE,
  constraint offline_order_syncs_seller_id_fkey foreign KEY (seller_id) references sellers (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists offline_order_syncs_device_idx on public.offline_order_syncs using btree (seller_id, device_id) TABLESPACE pg_default;

create index IF not exists idx_offline_order_syncs_seller_device on public.offline_order_syncs using btree (seller_id, device_id, synced_at desc) TABLESPACE pg_default;