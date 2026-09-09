begin;

create or replace function public.revoke_qr_code(
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr public.qr_codes%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_code, '')), '') is null then
    raise exception 'QR code is required.' using errcode = '22023';
  end if;

  select * into v_qr
  from public.qr_codes
  where seller_id = auth.uid()
    and lower(code) = lower(trim(p_code))
  for update;

  if not found then
    raise exception 'QR code not found in your shop.' using errcode = 'P0002';
  end if;

  if v_qr.status = 'assigned' then
    raise exception 'Assigned QR codes cannot be revoked.' using errcode = '23514';
  end if;

  if v_qr.status = 'revoked' then
    return jsonb_build_object(
      'revoked', false,
      'already_revoked', true,
      'qr_code_id', v_qr.id
    );
  end if;

  update public.qr_codes
  set status = 'revoked',
      revoked_at = now()
  where id = v_qr.id
    and seller_id = auth.uid();

  delete from public.offline_qr_reservations
  where qr_code_id = v_qr.id
    and seller_id = auth.uid();

  return jsonb_build_object(
    'revoked', true,
    'already_revoked', false,
    'qr_code_id', v_qr.id,
    'series_name', v_qr.series_name,
    'series_sequence', v_qr.series_sequence
  );
end;
$$;

revoke all on function public.revoke_qr_code(text) from public, anon, authenticated;
grant execute on function public.revoke_qr_code(text) to authenticated;

notify pgrst, 'reload schema';
commit;
