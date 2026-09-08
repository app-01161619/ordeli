begin;

-- Keep invitation creation independent from pgcrypto's gen_random_bytes().
create or replace function public.create_production_member_invite(
  p_name text,
  p_email text,
  p_section_label text default null,
  p_can_view_production boolean default true,
  p_can_scan_qr boolean default true,
  p_can_finish_stage boolean default true,
  p_can_upload_proof boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.production_members%rowtype;
  v_email text := lower(trim(p_email));
  v_token text := upper(replace(gen_random_uuid()::text, '-', ''));
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Name is required.'; end if;
  if v_email is null or v_email = '' then raise exception 'Email is required.'; end if;

  if not exists (select 1 from public.sellers s where s.id = auth.uid()) then
    raise exception 'Only the shop owner can create production member invitations.';
  end if;

  select * into v_member
  from public.production_members
  where seller_id = auth.uid()
    and lower(coalesce(email,'')) = v_email
    and is_active = true
  limit 1;

  if found then raise exception 'A production member with this email already exists.'; end if;

  insert into public.production_members(
    seller_id, name, email, section_label, role,
    can_view_production, can_scan_qr, can_finish_stage, can_upload_proof,
    is_active, invite_token, invite_status
  ) values (
    auth.uid(), trim(p_name), v_email, nullif(trim(p_section_label), ''), 'production_member',
    coalesce(p_can_view_production,true), coalesce(p_can_scan_qr,true), coalesce(p_can_finish_stage,true), coalesce(p_can_upload_proof,true),
    true, v_token, 'pending'
  ) returning * into v_member;

  return jsonb_build_object(
    'id', v_member.id,
    'name', v_member.name,
    'email', v_member.email,
    'invite_token', v_member.invite_token,
    'invite_status', v_member.invite_status
  );
end;
$$;

create or replace function public.get_production_invite(
  p_invite_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.production_members%rowtype;
begin
  select * into v_member
  from public.production_members
  where invite_token = upper(trim(p_invite_token))
    and is_active = true
    and invite_status = 'pending'
    and auth_user_id is null
  limit 1;

  if not found then raise exception 'This invitation is invalid, expired, or already used.'; end if;

  return jsonb_build_object(
    'name', v_member.name,
    'email', v_member.email,
    'section_label', v_member.section_label
  );
end;
$$;

create or replace function public.accept_production_member_invite(
  p_invite_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.production_members%rowtype;
  v_email text := lower(coalesce(auth.jwt() ->> 'email',''));
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;

  select * into v_member
  from public.production_members
  where invite_token = upper(trim(p_invite_token))
    and is_active = true
    and invite_status = 'pending'
    and auth_user_id is null
  for update;

  if not found then raise exception 'This invitation is invalid, expired, or already used.'; end if;
  if lower(coalesce(v_member.email,'')) <> v_email then raise exception 'The signed-in email does not match this invitation.'; end if;

  update public.production_members
  set auth_user_id = auth.uid(),
      invite_status = 'accepted',
      updated_at = now()
  where id = v_member.id;

  return jsonb_build_object(
    'member_id', v_member.id,
    'seller_id', v_member.seller_id,
    'name', v_member.name,
    'email', v_member.email
  );
end;
$$;

grant execute on function public.create_production_member_invite(text,text,text,boolean,boolean,boolean,boolean) to authenticated;
grant execute on function public.get_production_invite(text) to anon, authenticated;
grant execute on function public.accept_production_member_invite(text) to authenticated;

notify pgrst, 'reload schema';
commit;
