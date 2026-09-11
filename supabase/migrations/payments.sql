create table public.payments (
  id uuid not null default gen_random_uuid (),
  order_id uuid not null,
  seller_id uuid not null,
  amount numeric(12, 2) not null,
  payment_type text not null,
  proof_status text null,
  proof_path text null,
  rejection_reason text null,
  confirmed_by_user_id uuid null,
  confirmed_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  payment_method text null,
  constraint payments_pkey primary key (id),
  constraint payments_order_id_fkey foreign KEY (order_id) references orders (id) on delete CASCADE,
  constraint payments_confirmed_by_user_id_fkey foreign KEY (confirmed_by_user_id) references auth.users (id) on delete set null,
  constraint payments_seller_id_fkey foreign KEY (seller_id) references sellers (id) on delete CASCADE,
  constraint payments_proof_status_check check (
    (
      (proof_status is null)
      or (
        proof_status = any (
          array[
            'pending_verification'::text,
            'confirmed'::text,
            'rejected'::text
          ]
        )
      )
    )
  ),
  constraint payments_payment_method_check check (
    (
      (payment_method is null)
      or (
        payment_method = any (
          array[
            'cash'::text,
            'bank_transfer'::text,
            'digital_wallet'::text
          ]
        )
      )
    )
  ),
  constraint payments_amount_positive check ((amount > (0)::numeric)) not VALID,
  constraint payments_amount_check check ((amount > (0)::numeric)),
  constraint payments_payment_type_check check (
    (
      payment_type = any (
        array[
          'downpayment'::text,
          'additional'::text,
          'balance'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists payments_order_id_idx on public.payments using btree (order_id) TABLESPACE pg_default;

create index IF not exists payments_seller_id_idx on public.payments using btree (seller_id) TABLESPACE pg_default;

create index IF not exists payments_proof_status_idx on public.payments using btree (proof_status) TABLESPACE pg_default;

create index IF not exists idx_payments_order_created on public.payments using btree (order_id, created_at) TABLESPACE pg_default;

create index IF not exists payments_payment_method_idx on public.payments using btree (payment_method) TABLESPACE pg_default;

create trigger trg_payment_sms_update
after INSERT
or
update OF proof_status on payments for EACH row
execute FUNCTION trg_payment_sms_update ();