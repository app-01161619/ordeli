-- Ordeli master-prompt rebuild: Step 1 Seller + Shop
create table public.sellers (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  login_method text not null default 'email',
  google_id text,
  shop_name text,
  shop_address text,
  shop_logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sellers_login_method_valid check (login_method in ('email','google')),
  constraint sellers_shop_name_not_blank check (shop_name is null or length(trim(shop_name)) > 0),
  constraint sellers_shop_address_not_blank check (shop_address is null or length(trim(shop_address)) > 0)
);

create unique index sellers_google_id_unique_idx on public.sellers(google_id) where google_id is not null;
alter table public.sellers enable row level security;
revoke all on public.sellers from anon;
grant select, update on public.sellers to authenticated;

create policy "Sellers can view own seller profile"
on public.sellers for select to authenticated
using ((select auth.uid()) = id);

create policy "Sellers can update own seller profile"
on public.sellers for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create or replace function public.handle_new_seller()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare provider_name text;
begin
  provider_name := coalesce(new.raw_app_meta_data ->> 'provider','email');
  insert into public.sellers (id,email,login_method)
  values (
    new.id,new.email,
    case when provider_name = 'google' then 'google' else 'email' end
  )
  on conflict (id) do update set
    email = excluded.email,
    login_method = excluded.login_method,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_seller();

insert into storage.buckets (id,name,public)
values ('shop-logos','shop-logos',false)
on conflict (id) do update set public=false;

drop policy if exists "Sellers can upload own shop logo" on storage.objects;
create policy "Sellers can upload own shop logo"
on storage.objects for insert to authenticated
with check (
  bucket_id='shop-logos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists "Sellers can view own shop logo" on storage.objects;
create policy "Sellers can view own shop logo"
on storage.objects for select to authenticated
using (
  bucket_id='shop-logos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists "Sellers can update own shop logo" on storage.objects;
create policy "Sellers can update own shop logo"
on storage.objects for update to authenticated
using (
  bucket_id='shop-logos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
)
with check (
  bucket_id='shop-logos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists "Sellers can delete own shop logo" on storage.objects;
create policy "Sellers can delete own shop logo"
on storage.objects for delete to authenticated
using (
  bucket_id='shop-logos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);
