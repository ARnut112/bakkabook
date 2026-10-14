-- Run after orders.sql. Repeatable; keeps existing orders and stock unchanged.
begin;
alter table public.orders add column if not exists carrier text not null default '';
alter table public.orders add column if not exists tracking_number text not null default '';
alter table public.orders add column if not exists shipped_at timestamptz;
alter table public.orders add column if not exists received_at timestamptz;

-- Admin saves shipping details and the shipped state together.
create or replace function public.save_order_shipping(p_order_id uuid, p_carrier text, p_tracking_number text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if not (select public.is_book_admin()) then raise exception 'เฉพาะเจ้าของร้านเท่านั้น'; end if;
  if p_carrier is null or char_length(trim(p_carrier)) not between 1 and 80
    or p_tracking_number is null or char_length(trim(p_tracking_number)) not between 1 and 100 then
    raise exception 'กรุณากรอกบริษัทขนส่งและเลขพัสดุให้ครบ';
  end if;
  select status into v_status from public.orders where id = p_order_id for update;
  if not found or v_status not in ('confirmed', 'shipped') then
    raise exception 'ต้องยืนยันการชำระเงินก่อนบันทึกการจัดส่ง';
  end if;
  update public.orders set carrier = trim(p_carrier), tracking_number = trim(p_tracking_number),
    shipped_at = coalesce(shipped_at, now()), status = 'shipped' where id = p_order_id;
end;
$$;
revoke all on function public.save_order_shipping(uuid, text, text) from public, anon;
grant execute on function public.save_order_shipping(uuid, text, text) to authenticated;

-- Uses the same order-number/phone ownership check as the existing customer workflow.
-- Locks the order to prevent a receipt racing with admin cancellation or another click.
create or replace function public.confirm_order_received(p_order_id uuid, p_order_number text, p_phone text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if v_phone !~ '^[0-9]{8,15}$' then raise exception 'กรุณาตรวจสอบเบอร์โทรศัพท์'; end if;
  select * into v_order from public.orders where id = p_order_id
    and order_number = upper(trim(coalesce(p_order_number, '')))
    and regexp_replace(phone, '[^0-9]', '', 'g') = v_phone for update;
  if not found then raise exception 'ไม่พบคำสั่งซื้อที่ตรงกับข้อมูล'; end if;
  if v_order.status = 'completed' then return; end if;
  if v_order.status <> 'shipped' then raise exception 'ยืนยันรับสินค้าได้เมื่อร้านจัดส่งแล้วเท่านั้น'; end if;
  update public.orders set status = 'completed', received_at = now() where id = p_order_id;
end;
$$;
revoke all on function public.confirm_order_received(uuid, text, text) from public;
grant execute on function public.confirm_order_received(uuid, text, text) to anon, authenticated;

create or replace function public.get_customer_orders_by_phone(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_orders jsonb;
begin
  if v_phone !~ '^[0-9]{8,15}$' then
    raise exception 'กรุณากรอกเบอร์โทรศัพท์ที่ใช้สั่งซื้อ';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'order_id', q.id,
      'order_number', q.order_number,
      'created_at', q.created_at,
      'status', q.status,
      'payment_method', q.payment_method,
      'subtotal', q.total,
      'shipping_fee', q.shipping_fee,
      'amount_due', q.total + q.shipping_fee,
      'slip_submitted', q.slip_path is not null,
      'carrier', q.carrier,
      'tracking_number', q.tracking_number,
      'received_at', q.received_at,
      'items', q.items
    ) order by q.created_at desc),
    '[]'::jsonb
  )
  into v_orders
  from (
    select
      o.id, o.order_number, o.created_at, o.status, o.payment_method,
      o.total, o.shipping_fee, o.slip_path, o.carrier, o.tracking_number, o.received_at,
      (
        select coalesce(
          jsonb_agg(jsonb_build_object(
            'book_title', i.book_title,
            'unit_price', i.unit_price,
            'quantity', i.quantity
          ) order by i.id),
          '[]'::jsonb
        )
        from public.order_items i
        where i.order_id = o.id
      ) as items
    from public.orders o
    where regexp_replace(o.phone, '[^0-9]', '', 'g') = v_phone
    order by o.created_at desc
  ) q;

  if jsonb_array_length(v_orders) = 0 then
    raise exception 'ไม่พบคำสั่งซื้อจากเบอร์นี้ กรุณาตรวจสอบเบอร์โทรศัพท์';
  end if;

  return v_orders;
end;
$$;

revoke all on function public.get_customer_orders_by_phone(text) from public;
grant execute on function public.get_customer_orders_by_phone(text) to anon, authenticated;
commit;
