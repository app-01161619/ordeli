begin;

create or replace function public.update_production_member(
  p_member_id uuid,
  p_name text,
  p_section_label text,
  p_can_view_production boolean,
  p_can_scan_qr boolean,
  p_can_finish_stage boolean,
  p_can_upload_proof boolean
)
returns public.production_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.production_members;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if v_name is null then
    raise exception 'Member name is required.';
  end if;

  update public.production_members
     set name = v_name,
         section_label = nullif(trim(coalesce(p_section_label, '')), ''),
         can_view_production = coalesce(p_can_view_production, false),
         can_scan_qr = coalesce(p_can_scan_qr, false),
         can_finish_stage = coalesce(p_can_finish_stage, false),
         can_upload_proof = coalesce(p_can_upload_proof, false),
         updated_at = now()
   where id = p_member_id
     and seller_id = auth.uid()
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Production member not found.';
  end if;

  return v_row;
end;
$$;

create or replace function public.set_production_member_active(
  p_member_id uuid,
  p_active boolean
)
returns public.production_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.production_members;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  update public.production_members
     set is_active = coalesce(p_active, false),
         updated_at = now()
   where id = p_member_id
     and seller_id = auth.uid()
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Production member not found.';
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_production_member(uuid,text,text,boolean,boolean,boolean,boolean) from public, anon;
grant execute on function public.update_production_member(uuid,text,text,boolean,boolean,boolean,boolean) to authenticated;

revoke all on function public.set_production_member_active(uuid,boolean) from public, anon;
grant execute on function public.set_production_member_active(uuid,boolean) to authenticated;

commit;
