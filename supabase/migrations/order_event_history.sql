create table public.order_event_history (
  id uuid not null default gen_random_uuid (),
  order_id uuid not null,
  old_event_id uuid null,
  new_event_id uuid null,
  reason text null,
  changed_by_user_id uuid null,
  occurred_at timestamp with time zone not null default now(),
  constraint order_event_history_pkey primary key (id),
  constraint order_event_history_changed_by_user_id_fkey foreign KEY (changed_by_user_id) references auth.users (id) on delete set null,
  constraint order_event_history_new_event_id_fkey foreign KEY (new_event_id) references events (id) on delete set null,
  constraint order_event_history_old_event_id_fkey foreign KEY (old_event_id) references events (id) on delete set null,
  constraint order_event_history_order_id_fkey foreign KEY (order_id) references orders (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists order_event_history_order_id_idx on public.order_event_history using btree (order_id) TABLESPACE pg_default;

create index IF not exists idx_order_event_history_order_occurred on public.order_event_history using btree (order_id, occurred_at) TABLESPACE pg_default;