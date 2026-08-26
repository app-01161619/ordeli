-- ============================================
-- SELLER PROFILES
-- ============================================

create table public.seller_profiles (
    id uuid primary key
        references auth.users(id)
        on delete cascade,

    shop_name text not null,

    login_identifier text not null unique,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint seller_profiles_shop_name_not_blank
        check (length(trim(shop_name)) > 0),

    constraint seller_profiles_login_identifier_not_blank
        check (length(trim(login_identifier)) > 0)
);


-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

alter table public.seller_profiles
enable row level security;


-- Sellers can view their own profile.

create policy "Sellers can view own profile"
on public.seller_profiles
for select
to authenticated
using (
    auth.uid() = id
);


-- Sellers can update their own profile.

create policy "Sellers can update own profile"
on public.seller_profiles
for update
to authenticated
using (
    auth.uid() = id
)
with check (
    auth.uid() = id
);


-- ============================================
-- CREATE PROFILE AFTER AUTH USER CREATION
-- ============================================

create or replace function public.handle_new_seller()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

    insert into public.seller_profiles (
        id,
        shop_name,
        login_identifier
    )
    values (
        new.id,
        new.raw_user_meta_data ->> 'shop_name',
        new.raw_user_meta_data ->> 'login_identifier'
    );

    return new;

end;
$$;


-- ============================================
-- AUTH USER TRIGGER
-- ============================================

drop trigger if exists on_auth_user_created
on auth.users;


create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_seller();


-- ============================================
-- LOOK UP INTERNAL AUTH IDENTITY
-- ============================================

create or replace function public.get_login_identifier(
    requested_shop_name text
)
returns text
language sql
security definer
set search_path = public
as $$
    select login_identifier
    from public.seller_profiles
    where lower(trim(shop_name))
        = lower(trim(requested_shop_name))
    limit 1;
$$;


-- Allow unauthenticated users to perform
-- the shop-name lookup needed before login.

grant execute
on function public.get_login_identifier(text)
to anon;