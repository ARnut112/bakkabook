-- Run after orders.sql and shipping.sql. Repeatable; preserves orders.
begin;
create or replace function public.get_customer_order(p_order_number text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_items jsonb;
begin
  select * into v_order
  from public.orders
  where order_number = upper(trim(coalesce(p_order_number, '')))
    and regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if not found then
    raise exception 'ไม่พบคำสั่งซื้อ กรุณาตรวจเลขออเดอร์และเบอร์โทรศัพท์';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'book_title', book_title,
      'unit_price', unit_price,
      'quantity', quantity
    ) order by id),
    '[]'::jsonb
  )
  into v_items
  from public.order_items
  where order_id = v_order.id;

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'created_at', v_order.created_at,
    'carrier', v_order.carrier,
    'tracking_number', v_order.tracking_number,
    'received_at', v_order.received_at,
    'status', v_order.status,
    'payment_method', v_order.payment_method,
    'subtotal', v_order.total,
    'shipping_fee', v_order.shipping_fee,
    'amount_due', v_order.total + v_order.shipping_fee,
    'slip_submitted', v_order.slip_path is not null,
    'items', v_items
  );
end;
$$;

revoke all on function public.get_customer_order(text, text) from public;
grant execute on function public.get_customer_order(text, text) to anon, authenticated;


-- Revoke the old lookup for every browser role; UI changes alone do not protect data.
revoke all on function public.get_customer_orders_by_phone(text) from public, anon, authenticated;
commit;
