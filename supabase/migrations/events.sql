create table public.events (
  id uuid not null default gen_random_uuid (),
  seller_id uuid not null,
  name text not null,
  location text not null,
  event_date date not null,
  start_time time without time zone null,
  end_time time without time zone null,
  notes text null,
  status text not null default 'upcoming'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint events_pkey primary key (id),
  constraint events_seller_id_fkey foreign KEY (seller_id) references sellers (id) on delete CASCADE,
  constraint events_check check (
    (
      (end_time is null)
      or (start_time is null)
      or (end_time > start_time)
    )
  ),
  constraint events_location_check check (
    (
      length(
        TRIM(
          both
          from
            location
        )
      ) > 0
    )
  ),
  constraint events_name_check check (
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
  constraint events_status_check check (
    (
      status = any (
        array[
          'upcoming'::text,
          'ready'::text,
          'active'::text,
          'completed'::text,
          'cancelled'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists events_seller_id_idx on public.events using btree (seller_id) TABLESPACE pg_default;

create index IF not exists events_seller_date_idx on public.events using btree (seller_id, event_date) TABLESPACE pg_default;

create index IF not exists idx_events_seller_date on public.events using btree (seller_id, event_date, start_time) TABLESPACE pg_default;

create trigger events_set_updated_at BEFORE
update on events for EACH row
execute FUNCTION set_updated_at ();

create trigger trg_event_schedule_sms_update
after
update OF event_date,
start_time,
end_time on events for EACH row
execute FUNCTION trg_event_schedule_sms_update ();