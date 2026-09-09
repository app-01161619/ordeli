create table public.sellers (
  id uuid not null,
  email text null,
  login_method text not null default 'email'::text,
  google_id text null,
  shop_name text null,
  shop_address text null,
  shop_logo_path text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint sellers_pkey primary key (id),
  constraint sellers_id_fkey foreign KEY (id) references auth.users (id) on delete CASCADE,
  constraint sellers_login_method_check check (
    (
      login_method = any (array['email'::text, 'google'::text])
    )
  )
) TABLESPACE pg_default;

create unique INDEX IF not exists sellers_google_id_unique on public.sellers using btree (google_id) TABLESPACE pg_default
where
  (google_id is not null);

create trigger sellers_set_updated_at BEFORE
update on sellers for EACH row
execute FUNCTION set_updated_at ();