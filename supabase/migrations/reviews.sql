create table public.reviews (
  id uuid not null default gen_random_uuid (),
  order_id uuid not null,
  seller_id uuid not null,
  rating integer not null,
  review_text text null,
  created_at timestamp with time zone not null default now(),
  constraint reviews_pkey primary key (id),
  constraint reviews_order_id_key unique (order_id),
  constraint reviews_order_id_fkey foreign KEY (order_id) references orders (id) on delete CASCADE,
  constraint reviews_seller_id_fkey foreign KEY (seller_id) references sellers (id) on delete CASCADE,
  constraint reviews_rating_check check (
    (
      (rating >= 1)
      and (rating <= 5)
    )
  ),
  constraint reviews_rating_range check (
    (
      (rating >= 1)
      and (rating <= 5)
    )
  ) not VALID
) TABLESPACE pg_default;

create index IF not exists reviews_seller_id_idx on public.reviews using btree (seller_id) TABLESPACE pg_default;

create unique INDEX IF not exists uq_reviews_order_id on public.reviews using btree (order_id) TABLESPACE pg_default;