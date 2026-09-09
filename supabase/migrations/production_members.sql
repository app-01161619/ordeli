create table public.production_members (
  id uuid not null default gen_random_uuid (),
  seller_id uuid not null,
  auth_user_id uuid null,
  name text not null,
  section_label text null,
  role text not null default 'production_member'::text,
  can_view_production boolean not null default true,
  can_scan_qr boolean not null default true,
  can_finish_stage boolean not null default true,
  can_upload_proof boolean not null default true,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  email text null,
  invite_token text null,
  invite_status text not null default 'pending'::text,
  constraint production_members_pkey primary key (id),
  constraint production_members_auth_user_id_key unique (auth_user_id),
  constraint production_members_auth_user_id_fkey foreign KEY (auth_user_id) references auth.users (id) on delete set null,
  constraint production_members_seller_id_fkey foreign KEY (seller_id) references sellers (id) on delete CASCADE,
  constraint production_members_role_check check ((role = 'production_member'::text))
) TABLESPACE pg_default;

create index IF not exists production_members_seller_id_idx on public.production_members using btree (seller_id) TABLESPACE pg_default;

create index IF not exists idx_production_members_seller_id on public.production_members using btree (seller_id) TABLESPACE pg_default;

create index IF not exists production_members_email_idx on public.production_members using btree (lower(email)) TABLESPACE pg_default;

create unique INDEX IF not exists production_members_invite_token_uq on public.production_members using btree (invite_token) TABLESPACE pg_default
where
  (invite_token is not null);

create trigger production_members_set_updated_at BEFORE
update on production_members for EACH row
execute FUNCTION set_updated_at ();