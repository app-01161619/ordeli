-- DEVELOPMENT ONLY. DESTRUCTIVE.
-- Run only if you want to remove the previous prototype schema.
drop function if exists public.create_order(text,text,jsonb);
drop function if exists public.create_qr_series(uuid,text,integer);
drop function if exists public.product_belongs_to_current_seller(uuid);
drop function if exists public.get_login_identifier(text);
drop function if exists public.handle_new_seller();
drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.order_item_production_stages cascade;
drop table if exists public.order_items cascade;
drop table if exists public.orders cascade;
drop table if exists public.qr_codes cascade;
drop table if exists public.qr_series cascade;
drop table if exists public.production_stages cascade;
drop table if exists public.products cascade;
drop table if exists public.seller_profiles cascade;

drop policy if exists "Sellers can upload own shop logo" on storage.objects;
drop policy if exists "Sellers can view own shop logo" on storage.objects;
drop policy if exists "Sellers can update own shop logo" on storage.objects;
drop policy if exists "Sellers can delete own shop logo" on storage.objects;

delete from storage.objects where bucket_id='shop-logos';
delete from storage.buckets where id='shop-logos';
