-- ============================================
-- SHOP PROFILE FIELDS
-- ============================================

alter table public.seller_profiles
add column if not exists shop_address text;

alter table public.seller_profiles
add column if not exists shop_logo_path text;


-- ============================================
-- SHOP LOGO STORAGE BUCKET
-- ============================================

insert into storage.buckets (
    id,
    name,
    public
)
values (
    'shop-logos',
    'shop-logos',
    false
)
on conflict (id) do nothing;


-- ============================================
-- STORAGE POLICIES
-- ============================================

-- Sellers can upload files into their own folder.
--
-- File structure:
-- shop-logos/
--   USER_ID/
--     logo-file.png

create policy "Sellers can upload own shop logo"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'shop-logos'
    and
    (storage.foldername(name))[1] = auth.uid()::text
);


-- Sellers can view their own shop logo.

create policy "Sellers can view own shop logo"
on storage.objects
for select
to authenticated
using (
    bucket_id = 'shop-logos'
    and
    owner_id = auth.uid()::text
);


-- Sellers can delete their own shop logo.

create policy "Sellers can delete own shop logo"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'shop-logos'
    and
    owner_id = auth.uid()::text
);