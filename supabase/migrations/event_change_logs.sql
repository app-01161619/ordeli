create table public.event_change_logs (
  id uuid not null default gen_random_uuid (),
  event_id uuid not null,
  original_event_date date null,
  original_start_time time without time zone null,
  original_end_time time without time zone null,
  new_event_date date null,
  new_start_time time without time zone null,
  new_end_time time without time zone null,
  reason text null,
  changed_by_user_id uuid null,
  occurred_at timestamp with time zone not null default now(),
  constraint event_change_logs_pkey primary key (id),
  constraint event_change_logs_changed_by_user_id_fkey foreign KEY (changed_by_user_id) references auth.users (id) on delete set null,
  constraint event_change_logs_event_id_fkey foreign KEY (event_id) references events (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists event_change_logs_event_id_idx on public.event_change_logs using btree (event_id) TABLESPACE pg_default;

create index IF not exists idx_event_change_logs_event_occurred on public.event_change_logs using btree (event_id, occurred_at) TABLESPACE pg_default;