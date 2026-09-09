create table public.offline_qr_reservations (
  qr_code_id uuid not null,
  seller_id uuid not null,
  device_id text not null,
  reserved_at timestamp with time zone not null default now(),
  constraint offline_qr_reservations_pkey primary key (qr_code_id),
  constraint offline_qr_reservations_qr_code_id_fkey foreign KEY (qr_code_id) references qr_codes (id) on delete CASCADE,
  constraint offline_qr_reservations_seller_id_fkey foreign KEY (seller_id) references sellers (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists offline_qr_reservations_seller_idx on public.offline_qr_reservations using btree (seller_id) TABLESPACE pg_default;

create index IF not exists offline_qr_reservations_device_idx on public.offline_qr_reservations using btree (device_id) TABLESPACE pg_default;

create index IF not exists idx_offline_qr_reservations_device on public.offline_qr_reservations using btree (seller_id, device_id, reserved_at) TABLESPACE pg_default;