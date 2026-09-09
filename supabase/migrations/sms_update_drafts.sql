create table public.sms_update_drafts (
  id uuid not null default gen_random_uuid (),
  seller_id uuid not null,
  order_id uuid not null,
  triggered_by_user_id uuid null,
  message_text text not null,
  status text not null default 'ready'::text,
  created_at timestamp with time zone not null default now(),
  sent_marked_at timestamp with time zone null,
  constraint sms_update_drafts_pkey primary key (id),
  constraint sms_update_drafts_order_id_fkey foreign KEY (order_id) references orders (id) on delete CASCADE,
  constraint sms_update_drafts_seller_id_fkey foreign KEY (seller_id) references sellers (id) on delete CASCADE,
  constraint sms_update_drafts_triggered_by_user_id_fkey foreign KEY (triggered_by_user_id) references auth.users (id) on delete set null,
  constraint sms_update_drafts_status_check check (
    (
      status = any (
        array[
          'ready'::text,
          'dismissed'::text,
          'sent_marked'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists sms_update_drafts_seller_id_idx on public.sms_update_drafts using btree (seller_id) TABLESPACE pg_default;

create index IF not exists sms_update_drafts_order_id_idx on public.sms_update_drafts using btree (order_id) TABLESPACE pg_default;

create index IF not exists idx_sms_update_drafts_seller_status on public.sms_update_drafts using btree (seller_id, status, created_at desc) TABLESPACE pg_default;