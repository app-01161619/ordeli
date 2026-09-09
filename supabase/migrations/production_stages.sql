create table public.production_stages (
  id uuid not null default gen_random_uuid (),
  product_id uuid not null,
  name text not null,
  stage_order integer not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint production_stages_pkey primary key (id),
  constraint production_stages_product_id_stage_order_key unique (product_id, stage_order),
  constraint production_stages_product_id_fkey foreign KEY (product_id) references products (id) on delete CASCADE,
  constraint production_stages_name_check check (
    (
      length(
        TRIM(
          both
          from
            name
        )
      ) > 0
    )
  ),
  constraint production_stages_stage_order_check check ((stage_order > 0))
) TABLESPACE pg_default;

create index IF not exists production_stages_product_id_idx on public.production_stages using btree (product_id) TABLESPACE pg_default;

create index IF not exists idx_production_stages_product_order on public.production_stages using btree (product_id, stage_order) TABLESPACE pg_default;

create trigger production_stages_set_updated_at BEFORE
update on production_stages for EACH row
execute FUNCTION set_updated_at ();