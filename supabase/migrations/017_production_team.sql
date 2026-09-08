begin;

alter table public.production_members
  add column if not exists email text;

alter table public.production_members
  add column if not exists invite_token text;

alter table public.production_members
  add column if not exists invite_status text not null default 'pending';

create unique index if not exists production_members_invite_token_uq
  on public.production_members(invite_token)
  where invite_token is not null;

create index if not exists production_members_email_idx
  on public.production_members(lower(email));

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
  v_token text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
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

create or replace function public.get_current_actor()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller public.sellers%rowtype;
  v_member public.production_members%rowtype;
  v_email text := lower(coalesce(auth.jwt() ->> 'email',''));
begin
  if auth.uid() is null then return null; end if;

  select * into v_seller from public.sellers where id = auth.uid() limit 1;
  if found then
    return jsonb_build_object(
      'actor_type','seller', 'user_id',auth.uid(), 'seller_id',auth.uid(),
      'name',coalesce(v_seller.shop_name,'Seller'),
      'can_view_production',true,'can_scan_qr',true,'can_finish_stage',true,'can_upload_proof',true
    );
  end if;

  update public.production_members pm
  set auth_user_id = auth.uid(),
      invite_status = 'accepted',
      updated_at = now()
  where pm.auth_user_id is null
    and pm.is_active = true
    and lower(coalesce(pm.email,'')) = v_email;

  select * into v_member from public.production_members where auth_user_id = auth.uid() and is_active = true limit 1;
  if not found then return null; end if;

  return jsonb_build_object(
    'actor_type','production_member', 'user_id',auth.uid(), 'seller_id',v_member.seller_id,
    'member_id',v_member.id, 'name',v_member.name, 'email',v_member.email,
    'section_label',v_member.section_label, 'role',v_member.role,
    'can_view_production',v_member.can_view_production, 'can_scan_qr',v_member.can_scan_qr,
    'can_finish_stage',v_member.can_finish_stage, 'can_upload_proof',v_member.can_upload_proof
  );
end;
$$;

grant execute on function public.create_production_member_invite(text,text,text,boolean,boolean,boolean,boolean) to authenticated;
grant execute on function public.get_current_actor() to anon, authenticated;

create or replace function public.get_production_work(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.production_members%rowtype;
  v_result jsonb;
begin
  select * into v_member from public.production_members where auth_user_id = auth.uid() and is_active = true limit 1;
  if not found then raise exception 'Production member access is not available.'; end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at asc), '[]'::jsonb)
  into v_result
  from (
    select
      oi.id as order_item_id,
      o.order_number,
      c.name as customer_name,
      oi.product_name,
      oi.quantity,
      oi.created_at,
      st.stage_order,
      st.stage_name
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.customers c on c.id = o.customer_id
    cross join lateral (
      select
        (stage->>'stage_order')::integer as stage_order,
        stage->>'name' as stage_name
      from jsonb_array_elements(coalesce(oi.workflow_snapshot,'[]'::jsonb)) stage
      where not exists (
        select 1 from public.stage_logs sl
        where sl.order_item_id = oi.id
          and sl.stage_order = (stage->>'stage_order')::integer
          and sl.action = 'finished'
          and not exists (
            select 1 from public.stage_logs newer
            where newer.order_item_id = sl.order_item_id
              and newer.stage_order = sl.stage_order
              and newer.action = 'sent_back'
              and newer.occurred_at > sl.occurred_at
          )
      )
      order by (stage->>'stage_order')::integer
      limit 1
    ) st
    where oi.seller_id = v_member.seller_id
      and oi.cancelled_at is null
      and o.cancelled_at is null
    limit greatest(1, least(coalesce(p_limit,100),500))
  ) x;

  return v_result;
end;
$$;

grant execute on function public.get_production_work(integer) to authenticated;

create or replace function public.finish_production_stage_member(
  p_order_item_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.production_members%rowtype;
  v_item public.order_items%rowtype;
  v_stage jsonb;
  v_stage_order integer;
  v_stage_name text;
  v_next jsonb;
  v_owner_phone text;
  v_customer text;
  v_message text;
begin
  select * into v_member from public.production_members where auth_user_id = auth.uid() and is_active = true limit 1;
  if not found or not v_member.can_finish_stage then raise exception 'You do not have permission to finish production stages.'; end if;

  select * into v_item from public.order_items where id = p_order_item_id and seller_id = v_member.seller_id and cancelled_at is null for update;
  if not found then raise exception 'Production item not found.'; end if;

  select stage into v_stage
  from jsonb_array_elements(coalesce(v_item.workflow_snapshot,'[]'::jsonb)) stage
  where not exists (
    select 1 from public.stage_logs sl
    where sl.order_item_id = v_item.id
      and sl.stage_order = (stage->>'stage_order')::integer
      and sl.action = 'finished'
      and not exists (
        select 1 from public.stage_logs newer
        where newer.order_item_id = sl.order_item_id
          and newer.stage_order = sl.stage_order
          and newer.action = 'sent_back'
          and newer.occurred_at > sl.occurred_at
      )
  )
  order by (stage->>'stage_order')::integer
  limit 1;

  if v_stage is null then raise exception 'All production stages are already finished.'; end if;

  v_stage_order := (v_stage->>'stage_order')::integer;
  v_stage_name := v_stage->>'name';

  insert into public.stage_logs(order_item_id,stage_order,stage_name,action,performed_by_user_id,note,occurred_at)
  values (v_item.id,v_stage_order,v_stage_name,'finished',auth.uid(),nullif(trim(p_note),''),now());

  select stage into v_next
  from jsonb_array_elements(coalesce(v_item.workflow_snapshot,'[]'::jsonb)) stage
  where (stage->>'stage_order')::integer > v_stage_order
  order by (stage->>'stage_order')::integer
  limit 1;

  select c.name into v_customer from public.orders o join public.customers c on c.id=o.customer_id where o.id=v_item.order_id;
  select s.email into v_owner_phone from public.sellers s where s.id=v_member.seller_id;

  -- Seller-only SMS draft; the seller decides whether to open/send it.
  if v_customer is not null then
    v_message := format('Hi %s, your %s production stage "%s" is finished. Please check your order for the latest update.', v_customer, v_item.product_name, v_stage_name);
    insert into public.sms_update_drafts(seller_id,order_id,triggered_by_user_id,message_text,status)
    select v_member.seller_id, o.id, auth.uid(), v_message, 'ready'
    from public.orders o where o.id = v_item.order_id;
  end if;

  return jsonb_build_object(
    'order_item_id', v_item.id,
    'stage_order', v_stage_order,
    'stage_name', v_stage_name,
    'next_stage_order', case when v_next is null then null else (v_next->>'stage_order')::integer end,
    'completed', v_next is null
  );
end;
$$;

grant execute on function public.finish_production_stage_member(uuid,text) to authenticated;

-- A production member can view their own membership row; seller ownership remains through owner policies.
drop policy if exists production_member_select_self on public.production_members;
create policy production_member_select_self on public.production_members
for select to authenticated
using (auth_user_id = auth.uid());

notify pgrst, 'reload schema';
commit;
