-- ============================================================
-- 007_payment_management.sql
-- Ordeli Step 7: Seller Payment Recording
--
-- The master schema already contains public.payments.
-- This migration only makes sure the seller-facing table policies
-- allow the seller to view and record their own payments.
-- ============================================================

alter table public.payments
enable row level security;

revoke all
on public.payments
from anon;

grant select, insert
on public.payments
to authenticated;

drop policy if exists
"Payments sellers can view own"
on public.payments;

create policy
"Payments sellers can view own"
on public.payments
for select
to authenticated
using (
  seller_id = (select auth.uid())
);

drop policy if exists
"Payments sellers can create own"
on public.payments;

create policy
"Payments sellers can create own"
on public.payments
for insert
to authenticated
with check (
  seller_id = (select auth.uid())
);
