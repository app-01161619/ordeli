-- Seller-recorded payment method metadata.
alter table public.payments
  add column if not exists payment_method text null;

alter table public.payments
  drop constraint if exists payments_payment_method_check;

alter table public.payments
  add constraint payments_payment_method_check check (
    payment_method is null or payment_method = any (array['cash'::text,'bank_transfer'::text,'digital_wallet'::text])
  );

create index if not exists payments_payment_method_idx on public.payments (payment_method);
