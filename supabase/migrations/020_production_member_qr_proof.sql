begin;

insert into storage.buckets (id, name, public)
values ('production-proofs', 'production-proofs', false)
on conflict (id) do nothing;

create or replace function public.production_member_can_upload_to_seller(p_seller_id_text text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.production_members pm
    where pm.auth_user_id = auth.uid()
      and pm.seller_id::text = p_seller_id_text
      and pm.is_active = true
      and pm.can_upload_proof = true
  );
$$;

grant execute on function public.production_member_can_upload_to_seller(text) to authenticated;

drop policy if exists production_member_upload_proof on storage.objects;
create policy production_member_upload_proof
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'production-proofs'
  and public.production_member_can_upload_to_seller((storage.foldername(name))[1])
);

create or replace function public.resolve_production_qr(p_public_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.production_members%rowtype;
  v_qr public.qr_codes%rowtype;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_stage jsonb;
begin
  select * into v_member from public.production_members where auth_user_id=auth.uid() and is_active=true limit 1;
  if not found then raise exception 'Production member access is not available.'; end if;
  if not v_member.can_scan_qr then raise exception 'You do not have permission to scan QR codes.'; end if;

  select * into v_qr from public.qr_codes where public_token=p_public_token limit 1;
  if not found or v_qr.order_item_id is null then raise exception 'This QR is not assigned to an active production item.'; end if;

  select * into v_item from public.order_items where id=v_qr.order_item_id and seller_id=v_member.seller_id and cancelled_at is null limit 1;
  if not found then raise exception 'This QR does not belong to your shop.'; end if;

  select * into v_order from public.orders where id=v_item.order_id and cancelled_at is null limit 1;
  if not found then raise exception 'The order is not active.'; end if;

  select stage into v_stage
  from jsonb_array_elements(coalesce(v_item.workflow_snapshot,'[]'::jsonb)) stage
  where not exists (
    select 1 from public.stage_logs sl
    where sl.order_item_id=v_item.id
      and sl.stage_order=(stage->>'stage_order')::integer
      and sl.action='finished'
      and not exists (
        select 1 from public.stage_logs newer
        where newer.order_item_id=sl.order_item_id
          and newer.stage_order=sl.stage_order
          and newer.action='sent_back'
          and newer.occurred_at>sl.occurred_at
      )
  )
  order by (stage->>'stage_order')::integer limit 1;

  return jsonb_build_object(
    'order_item_id',v_item.id,
    'order_id',v_order.id,
    'order_number',v_order.order_number,
    'customer_name',(select c.name from public.customers c where c.id=v_order.customer_id),
    'product_name',v_item.product_name,
    'quantity',v_item.quantity,
    'stage_order',case when v_stage is null then null else (v_stage->>'stage_order')::integer end,
    'stage_name',case when v_stage is null then null else v_stage->>'name' end
  );
end;
$$;

grant execute on function public.resolve_production_qr(text) to authenticated;

create or replace function public.finish_production_stage_member_v2(
  p_order_item_id uuid,
  p_note text default null,
  p_proof_photo_path text default null
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
  v_next jsonb;
  v_stage_order integer;
  v_stage_name text;
  v_customer text;
  v_token text;
  v_message text;
begin
  select * into v_member from public.production_members where auth_user_id=auth.uid() and is_active=true limit 1;
  if not found then raise exception 'This account is not linked to an active production-team member.'; end if;
  if not v_member.can_finish_stage then raise exception 'You do not have permission to finish production stages.'; end if;
  if p_proof_photo_path is not null and not v_member.can_upload_proof then raise exception 'You do not have permission to upload proof photos.'; end if;
  if p_proof_photo_path is not null and split_part(p_proof_photo_path,'/',1) <> v_member.seller_id::text then raise exception 'Invalid proof photo path.'; end if;

  select * into v_item from public.order_items where id=p_order_item_id and seller_id=v_member.seller_id and cancelled_at is null for update;
  if not found then raise exception 'Production item not found.'; end if;

  select stage into v_stage
  from jsonb_array_elements(coalesce(v_item.workflow_snapshot,'[]'::jsonb)) stage
  where not exists (
    select 1 from public.stage_logs sl
    where sl.order_item_id=v_item.id and sl.stage_order=(stage->>'stage_order')::integer and sl.action='finished'
      and not exists (
        select 1 from public.stage_logs newer where newer.order_item_id=sl.order_item_id and newer.stage_order=sl.stage_order and newer.action='sent_back' and newer.occurred_at>sl.occurred_at
      )
  )
  order by (stage->>'stage_order')::integer limit 1;

  if v_stage is null then raise exception 'All production stages are already finished.'; end if;
  v_stage_order := (v_stage->>'stage_order')::integer;
  v_stage_name := v_stage->>'name';

  insert into public.stage_logs(order_item_id,stage_order,stage_name,action,performed_by_user_id,note,proof_photo_path,occurred_at)
  values(v_item.id,v_stage_order,v_stage_name,'finished',auth.uid(),nullif(trim(p_note),''),p_proof_photo_path,now());

  select stage into v_next
  from jsonb_array_elements(coalesce(v_item.workflow_snapshot,'[]'::jsonb)) stage
  where (stage->>'stage_order')::integer > v_stage_order
  order by (stage->>'stage_order')::integer limit 1;

  select c.name into v_customer from public.orders o join public.customers c on c.id=o.customer_id where o.id=v_item.order_id;
  select q.public_token into v_token from public.qr_codes q where q.order_item_id=v_item.id limit 1;

  if v_customer is not null then
    v_message := format('Hi %s, your %s production stage "%s" is finished. Please check your order here: %s', v_customer, v_item.product_name, v_stage_name, case when v_token is null then '' else '/t/' || v_token end);
    insert into public.sms_update_drafts(seller_id,order_id,triggered_by_user_id,message_text,status)
    select v_member.seller_id,o.id,auth.uid(),v_message,'ready' from public.orders o where o.id=v_item.order_id;
  end if;

  return jsonb_build_object('order_item_id',v_item.id,'stage_order',v_stage_order,'stage_name',v_stage_name,'next_stage_order',case when v_next is null then null else (v_next->>'stage_order')::integer end,'completed',v_next is null,'proof_photo_path',p_proof_photo_path);
end;
$$;

grant execute on function public.finish_production_stage_member_v2(uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
