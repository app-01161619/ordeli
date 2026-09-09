create table public.order_items (
  id uuid not null default gen_random_uuid (),
  order_id uuid not null,
  seller_id uuid not null,
  product_id uuid not null,
  qr_code_id uuid null,
  product_name text not null,
  quantity integer not null,
  unit_price numeric(12, 2) not null,
  total_price numeric(12, 2) not null,
  workflow_snapshot jsonb not null default '[]'::jsonb,
  cancellable_until_stage integer null,
  cancelled_at timestamp with time zone null,
  cancel_reason text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint order_items_pkey primary key (id),
  constraint order_items_order_id_fkey foreign KEY (order_id) references orders (id) on delete CASCADE,
  constraint order_items_qr_code_id_fkey foreign KEY (qr_code_id) references qr_codes (id) on delete RESTRICT,
  constraint order_items_product_id_fkey foreign KEY (product_id) references products (id) on delete RESTRICT,
  constraint order_items_seller_id_fkey foreign KEY (seller_id) references sellers (id) on delete CASCADE,
  constraint order_items_total_price_nonnegative check ((total_price >= (0)::numeric)) not VALID,
  constraint order_items_unit_price_check check ((unit_price >= (0)::numeric)),
  constraint order_items_unit_price_nonnegative check ((unit_price >= (0)::numeric)) not VALID,
  constraint order_items_cancellable_until_stage_check check (
    (
      (cancellable_until_stage is null)
      or (cancellable_until_stage > 0)
    )
  ),
  constraint order_items_workflow_snapshot_check check ((jsonb_typeof(workflow_snapshot) = 'array'::text)),
  constraint order_items_product_name_check check (
    (
      length(
        TRIM(
          both
          from
            product_name
        )
      ) > 0
    )
  ),
  constraint order_items_quantity_check check ((quantity > 0)),
  constraint order_items_quantity_positive check ((quantity > 0)) not VALID,
  constraint order_items_total_price_check check ((total_price >= (0)::numeric))
) TABLESPACE pg_default;

create index IF not exists order_items_product_id_idx on public.order_items using btree (product_id) TABLESPACE pg_default;

create index IF not exists order_items_order_id_idx on public.order_items using btree (order_id) TABLESPACE pg_default;

create index IF not exists order_items_seller_id_idx on public.order_items using btree (seller_id) TABLESPACE pg_default;

create unique INDEX IF not exists order_items_qr_unique on public.order_items using btree (qr_code_id) TABLESPACE pg_default
where
  (qr_code_id is not null);

create index IF not exists idx_order_items_order on public.order_items using btree (order_id) TABLESPACE pg_default;

create index IF not exists idx_order_items_seller on public.order_items using btree (seller_id) TABLESPACE pg_default;

create trigger order_items_set_updated_at BEFORE
update on order_items for EACH row
execute FUNCTION set_updated_at ();

create trigger trg_order_item_sms_update
after INSERT on order_items for EACH row
execute FUNCTION trg_order_item_sms_update ();