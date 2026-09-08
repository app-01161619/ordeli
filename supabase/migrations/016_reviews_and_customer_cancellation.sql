begin;

create or replace function public.get_customer_post_purchase_actions(
  p_public_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr public.qr_codes%rowtype;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_review public.reviews%rowtype;
  v_max_finished integer := 0;
  v_available_cancel boolean := false;
  v_cancel_hint text := '';
  v_cutoff integer;
begin
  select * into v_qr from public.qr_codes where public_token = p_public_token limit 1;
  if not found or v_qr.order_item_id is null then
    raise exception 'Tracking link not found.';
  end if;

  select * into v_item
  from public.order_items
  where id = v_qr.order_item_id
  limit 1;
  if not found then raise exception 'Order item not found.'; end if;

  select * into v_order
  from public.orders
  where id = v_item.order_id
  limit 1;
  if not found then raise exception 'Order not found.'; end if;

  select max(stage_order) into v_max_finished
  from public.stage_logs
  where order_item_id = v_item.id
    and action = 'finished'
    and not exists (
      select 1 from public.stage_logs newer
      where newer.order_item_id = stage_logs.order_item_id
        and newer.stage_order = stage_logs.stage_order
        and newer.action = 'sent_back'
        and newer.occurred_at > stage_logs.occurred_at
    );

  v_cutoff := v_item.cancellable_until_stage;
  v_available_cancel :=
    v_order.cancelled_at is null
    and v_item.cancelled_at is null
    and v_order.handed_over_at is null
    and v_order.fulfillment_type <> 'courier'
    and v_cutoff is not null
    and coalesce(v_max_finished, 0) <= v_cutoff;

  if v_available_cancel then
    v_cancel_hint := format(
      'Cancellation is available until production stage %s is finished.',
      v_cutoff
    );
  end if;

  select * into v_review
  from public.reviews
  where order_id = v_order.id
  limit 1;

  return jsonb_build_object(
    'review', jsonb_build_object(
      'available', v_order.cancelled_at is null and (v_order.handed_over_at is not null or v_order.fulfillment_type = 'courier'),
      'submitted', v_review.id is not null,
      'rating', v_review.rating,
      'review_text', v_review.review_text
    ),
    'cancellation', jsonb_build_object(
      'available', v_available_cancel,
      'cancelled', v_item.cancelled_at is not null,
      'cutoff_stage', v_cutoff,
      'current_finished_stage', coalesce(v_max_finished, 0),
      'hint', v_cancel_hint
    )
  );
end;
$$;

create or replace function public.submit_customer_review(
  p_public_token text,
  p_rating integer,
  p_review_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr public.qr_codes%rowtype;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_review public.reviews%rowtype;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5.';
  end if;

  select * into v_qr from public.qr_codes where public_token = p_public_token limit 1;
  if not found or v_qr.order_item_id is null then raise exception 'Tracking link not found.'; end if;
  select * into v_item from public.order_items where id = v_qr.order_item_id limit 1;
  select * into v_order from public.orders where id = v_item.order_id limit 1;

  if v_order.cancelled_at is not null then raise exception 'Cancelled orders cannot be reviewed.'; end if;
  if v_order.handed_over_at is null and v_order.fulfillment_type <> 'courier' then
    raise exception 'Your review becomes available after pickup or courier selection.';
  end if;

  if exists (select 1 from public.reviews where order_id = v_order.id) then
    raise exception 'This order already has a review.';
  end if;

  insert into public.reviews(order_id, seller_id, rating, review_text)
  values (v_order.id, v_order.seller_id, p_rating, nullif(trim(p_review_text), ''))
  returning * into v_review;

  return jsonb_build_object(
    'id', v_review.id,
    'order_id', v_review.order_id,
    'rating', v_review.rating,
    'review_text', v_review.review_text
  );
end;
$$;

create or replace function public.cancel_customer_order_item(
  p_public_token text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr public.qr_codes%rowtype;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_max_finished integer := 0;
begin
  select * into v_qr from public.qr_codes where public_token = p_public_token limit 1;
  if not found or v_qr.order_item_id is null then raise exception 'Tracking link not found.'; end if;

  select * into v_item from public.order_items where id = v_qr.order_item_id for update;
  select * into v_order from public.orders where id = v_item.order_id for update;

  select coalesce(max(stage_order), 0) into v_max_finished
  from public.stage_logs
  where order_item_id = v_item.id
    and action = 'finished'
    and not exists (
      select 1 from public.stage_logs newer
      where newer.order_item_id = stage_logs.order_item_id
        and newer.stage_order = stage_logs.stage_order
        and newer.action = 'sent_back'
        and newer.occurred_at > stage_logs.occurred_at
    );

  if v_order.cancelled_at is not null then raise exception 'This order is already cancelled.'; end if;
  if v_item.cancelled_at is not null then raise exception 'This item is already cancelled.'; end if;
  if v_order.handed_over_at is not null then raise exception 'This order has already been handed over.'; end if;
  if v_item.cancellable_until_stage is null then raise exception 'Customer cancellation is not enabled for this product.'; end if;
  if v_max_finished > v_item.cancellable_until_stage then
    raise exception 'Customer cancellation is no longer available because production has progressed beyond the allowed stage.';
  end if;

  update public.order_items
  set cancelled_at = now(),
      cancel_reason = coalesce(nullif(trim(p_reason), ''), 'Customer cancelled'),
      updated_at = now()
  where id = v_item.id;

  return jsonb_build_object(
    'order_item_id', v_item.id,
    'order_id', v_item.order_id,
    'cancelled', true
  );
end;
$$;

grant execute on function public.get_customer_post_purchase_actions(text) to anon, authenticated;
grant execute on function public.submit_customer_review(text, integer, text) to anon, authenticated;
grant execute on function public.cancel_customer_order_item(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
