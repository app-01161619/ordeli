create table public.stage_logs (
  id uuid not null default gen_random_uuid (),
  order_item_id uuid not null,
  stage_order integer not null,
  stage_name text not null,
  action text not null,
  performed_by_user_id uuid null,
  note text null,
  proof_photo_path text null,
  occurred_at timestamp with time zone not null default now(),
  constraint stage_logs_pkey primary key (id),
  constraint stage_logs_order_item_id_fkey foreign KEY (order_item_id) references order_items (id) on delete CASCADE,
  constraint stage_logs_performed_by_user_id_fkey foreign KEY (performed_by_user_id) references auth.users (id) on delete set null,
  constraint stage_logs_action_check check (
    (
      action = any (array['finished'::text, 'sent_back'::text])
    )
  ),
  constraint stage_logs_stage_name_check check (
    (
      length(
        TRIM(
          both
          from
            stage_name
        )
      ) > 0
    )
  ),
  constraint stage_logs_stage_order_check check ((stage_order > 0))
) TABLESPACE pg_default;

create index IF not exists stage_logs_order_item_id_idx on public.stage_logs using btree (order_item_id) TABLESPACE pg_default;

create index IF not exists stage_logs_performed_by_idx on public.stage_logs using btree (performed_by_user_id) TABLESPACE pg_default;

create index IF not exists idx_stage_logs_order_item_occurred on public.stage_logs using btree (order_item_id, occurred_at) TABLESPACE pg_default;

create trigger trg_stage_log_sms_update
after INSERT on stage_logs for EACH row
execute FUNCTION trg_stage_log_sms_update ();