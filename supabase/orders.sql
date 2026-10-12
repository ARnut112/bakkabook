-- Run in the SQL Editor to install or update the shop's order workflow. Safe to rerun.
begin;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_name text not null check (char_length(trim(customer_name)) between 2 and 100),
  phone text not null check (char_length(trim(phone)) between 8 and 20),
  line_id text not null default '' check (char_length(line_id) <= 100),
  address text not null check (char_length(trim(address)) between 5 and 1000),
  note text not null default '' check (char_length(note) <= 500),
  payment_method text not null default 'contact' check (payment_method in ('contact','qr')),
  total numeric(10,2) not null check (total >= 0),
  shipping_fee numeric(10,2) not null default 0 check (shipping_fee >= 0),
  slip_path text,
  status text not null default 'pending' check (status in ('pending','confirmed','shipped','cancelled')),
  created_at timestamptz not null default now()
);
alter table public.orders add column if not exists line_id text not null default '';
alter table public.orders add column if not exists payment_method text not null default 'contact';
alter table public.orders add column if not exists shipping_fee numeric(10,2) not null default 0;
alter table public.orders add column if not exists slip_path text;
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('pending','contacted','awaiting_payment','slip_submitted','confirmed','shipped','completed','cancelled'));
alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check check (payment_method in ('contact','qr'));
alter table public.orders drop constraint if exists orders_shipping_fee_check;
alter table public.orders add constraint orders_shipping_fee_check check (shipping_fee >= 0);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  book_id uuid references public.books(id) on delete set null,
  book_title text not null,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity between 1 and 99)
);
create index if not exists orders_created_at on public.orders(created_at desc);
create index if not exists order_items_order_id on public.order_items(order_id);

create table if not exists public.shop_payment_settings (
  id boolean primary key default true check (id),
  qr_image_url text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.shop_payment_settings(id) values (true) on conflict (id) do nothing;
alter table public.shop_payment_settings enable row level security;
revoke all on public.shop_payment_settings from anon, authenticated;
grant select on public.shop_payment_settings to anon, authenticated;
grant update on public.shop_payment_settings to authenticated;
drop policy if exists "Public can read payment QR" on public.shop_payment_settings;
create policy "Public can read payment QR" on public.shop_payment_settings for select to anon, authenticated using (true);
drop policy if exists "Admins update payment QR" on public.shop_payment_settings;
create policy "Admins update payment QR" on public.shop_payment_settings for update to authenticated
  using ((select public.is_book_admin())) with check ((select public.is_book_admin()));

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
revoke all on public.orders, public.order_items from anon, authenticated;
grant select on public.orders, public.order_items to authenticated;
drop policy if exists "Admins read orders" on public.orders;
create policy "Admins read orders" on public.orders for select to authenticated
  using ((select public.is_book_admin()));
drop policy if exists "Admins read order items" on public.order_items;
create policy "Admins read order items" on public.order_items for select to authenticated
  using ((select public.is_book_admin()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('payment-qr','payment-qr',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('payment-slips','payment-slips',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists "Public can view payment QR images" on storage.objects;
create policy "Public can view payment QR images" on storage.objects for select to public using (bucket_id='payment-qr');
drop policy if exists "Admins manage payment QR images" on storage.objects;
create policy "Admins manage payment QR images" on storage.objects for all to authenticated
  using (bucket_id='payment-qr' and (select public.is_book_admin()))
  with check (bucket_id='payment-qr' and (select public.is_book_admin()));

create or replace function public.payment_slip_upload_is_open(p_order_folder text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from public.orders where id::text=p_order_folder and payment_method='qr' and status in ('awaiting_payment','slip_submitted'));
$$;
revoke all on function public.payment_slip_upload_is_open(text) from public;
grant execute on function public.payment_slip_upload_is_open(text) to anon, authenticated;
drop policy if exists "Customers upload payment slips for open orders" on storage.objects;
create policy "Customers upload payment slips for open orders" on storage.objects for insert to anon, authenticated
  with check (bucket_id='payment-slips' and (select public.payment_slip_upload_is_open(split_part(name,'/',1))));
drop policy if exists "Customers replace payment slips for open orders" on storage.objects;
create policy "Customers replace payment slips for open orders" on storage.objects for update to anon, authenticated
  using (bucket_id='payment-slips' and (select public.payment_slip_upload_is_open(split_part(name,'/',1))))
  with check (bucket_id='payment-slips' and (select public.payment_slip_upload_is_open(split_part(name,'/',1))));
drop policy if exists "Admins read payment slips" on storage.objects;
create policy "Admins read payment slips" on storage.objects for select to authenticated
  using (bucket_id='payment-slips' and (select public.is_book_admin()));

drop function if exists public.create_book_order(text,text,text,text,jsonb);
create or replace function public.create_book_order(
  p_customer_name text,
  p_phone text,
  p_line_id text,
  p_address text,
  p_note text,
  p_items jsonb
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_order_id uuid;
  v_order_number text;
  v_total numeric(10,2) := 0;
  v_item record;
  v_book public.books%rowtype;
begin
  if char_length(trim(coalesce(p_customer_name,''))) not between 2 and 100 then
    raise exception 'กรุณากรอกชื่อผู้รับให้ครบถ้วน';
  end if;
  if char_length(trim(coalesce(p_phone,''))) not between 8 and 20 then
    raise exception 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง';
  end if;
  if regexp_replace(trim(p_phone),'[^0-9]','','g') !~ '^[0-9]{8,15}$' then raise exception 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง'; end if;
  if char_length(coalesce(p_line_id,'')) > 100 then raise exception 'LINE ID ยาวเกินไป'; end if;
  if char_length(trim(coalesce(p_address,''))) not between 5 and 1000 then
    raise exception 'กรุณากรอกที่อยู่จัดส่งให้ครบถ้วน';
  end if;
  if char_length(coalesce(p_note,'')) > 500 then raise exception 'หมายเหตุยาวเกินไป'; end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'ตะกร้าหนังสือไม่ถูกต้อง'; end if;
  if jsonb_array_length(p_items) not between 1 and 30 then raise exception 'ตะกร้าหนังสือไม่ถูกต้อง'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as entry(item)
    where jsonb_typeof(item) <> 'object'
      or coalesce(item->>'book_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(item->>'quantity','') !~ '^[1-9][0-9]{0,1}$'
  ) then raise exception 'รายการหนังสือหรือจำนวนไม่ถูกต้อง'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as entry(item)
    group by (entry.item->>'book_id') having sum((entry.item->>'quantity')::integer) > 99
  ) then raise exception 'หนังสือแต่ละเล่มสั่งได้ไม่เกิน 99 เล่ม'; end if;
  perform pg_advisory_xact_lock(hashtextextended(regexp_replace(trim(p_phone),'[^0-9]','','g'),0));
  if exists (
    select 1 from public.orders
    where regexp_replace(phone,'[^0-9]','','g') = regexp_replace(trim(p_phone),'[^0-9]','','g')
      and status <> 'cancelled' and created_at > now() - interval '1 minute'
  ) then raise exception 'มีคำสั่งซื้อจากเบอร์นี้เข้ามาเมื่อครู่ กรุณารอสักครู่ก่อนส่งอีกครั้ง'; end if;

  -- Lock each requested book in a stable order, verify current stock and calculate prices on the server.
  for v_item in
    select (entry.item->>'book_id')::uuid as book_id,
      sum((entry.item->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as entry(item)
    group by 1 order by 1
  loop
    select * into v_book from public.books where id = v_item.book_id for update;
    if not found or v_book.status <> 'published' then raise exception 'มีหนังสือบางรายการที่ไม่พร้อมจำหน่าย'; end if;
    if v_book.stock < v_item.quantity then raise exception 'หนังสือ “%” มีจำนวนไม่พอตามที่สั่ง', v_book.title; end if;
    v_total := v_total + v_book.price * v_item.quantity;
  end loop;

  v_order_number := 'BK-' || to_char(now(),'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.orders(order_number,customer_name,phone,line_id,address,note,total)
    values (v_order_number,trim(p_customer_name),trim(p_phone),trim(coalesce(p_line_id,'')),trim(p_address),trim(coalesce(p_note,'')),v_total)
    returning id into v_order_id;

  for v_item in
    select (entry.item->>'book_id')::uuid as book_id,
      sum((entry.item->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as entry(item)
    group by 1 order by 1
  loop
    select * into v_book from public.books where id = v_item.book_id;
    insert into public.order_items(order_id,book_id,book_title,unit_price,quantity)
      values (v_order_id,v_book.id,v_book.title,v_book.price,v_item.quantity);
    update public.books set stock = stock - v_item.quantity where id = v_book.id;
  end loop;
  return v_order_number;
end;
$$;
revoke all on function public.create_book_order(text,text,text,text,text,jsonb) from public;
grant execute on function public.create_book_order(text,text,text,text,text,jsonb) to anon, authenticated;

create or replace function public.submit_book_order(
  p_customer_name text,
  p_phone text,
  p_line_id text,
  p_address text,
  p_note text,
  p_payment_method text,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_order_number text;
  v_order_id uuid;
begin
  if p_payment_method is null or p_payment_method not in ('qr','contact') then raise exception 'กรุณาเลือกวิธีชำระเงิน'; end if;
  if p_payment_method='contact' and char_length(trim(coalesce(p_line_id,'')))=0 then raise exception 'กรุณากรอก LINE ID หรือชื่อ Facebook เพื่อให้ร้านติดต่อกลับ'; end if;
  if p_payment_method='qr' and not exists(select 1 from public.shop_payment_settings where id and qr_image_url<>'') then
    raise exception 'ร้านยังไม่ได้ตั้งค่า QR รับเงิน กรุณาติดต่อร้านก่อนทำรายการ';
  end if;
  v_order_number := public.create_book_order(p_customer_name,p_phone,p_line_id,p_address,p_note,p_items);
  if p_payment_method='qr' then
    update public.orders set payment_method='qr',status='awaiting_payment',shipping_fee=0 where order_number=v_order_number returning id into v_order_id;
  else
    update public.orders set payment_method='contact',status='pending',shipping_fee=0 where order_number=v_order_number returning id into v_order_id;
  end if;
  return jsonb_build_object('order_number',v_order_number,'order_id',v_order_id);
end;
$$;
revoke all on function public.submit_book_order(text,text,text,text,text,text,jsonb) from public;
grant execute on function public.submit_book_order(text,text,text,text,text,text,jsonb) to anon, authenticated;

create or replace function public.get_customer_order(p_order_number text,p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_items jsonb;
begin
  select * into v_order from public.orders
  where order_number=upper(trim(coalesce(p_order_number,'')))
    and regexp_replace(phone,'[^0-9]','','g')=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  if not found then raise exception 'ไม่พบคำสั่งซื้อ กรุณาตรวจเลขออเดอร์และเบอร์โทรศัพท์'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('book_title',book_title,'unit_price',unit_price,'quantity',quantity) order by id),'[]'::jsonb)
    into v_items from public.order_items where order_id=v_order.id;
  return jsonb_build_object('order_id',v_order.id,'order_number',v_order.order_number,'status',v_order.status,
    'payment_method',v_order.payment_method,'subtotal',v_order.total,'shipping_fee',v_order.shipping_fee,
    'amount_due',v_order.total+v_order.shipping_fee,'slip_submitted',v_order.slip_path is not null,'items',v_items);
end;
$$;
revoke all on function public.get_customer_order(text,text) from public;
grant execute on function public.get_customer_order(text,text) to anon, authenticated;

create or replace function public.get_customer_orders_by_phone(p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v_orders jsonb;
begin
  if v_phone !~ '^[0-9]{8,15}$' then raise exception 'กรุณากรอกเบอร์โทรศัพท์ที่ใช้สั่งซื้อ'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id',q.id,'order_number',q.order_number,'created_at',q.created_at,'status',q.status,
    'payment_method',q.payment_method,'subtotal',q.total,'shipping_fee',q.shipping_fee,
    'amount_due',q.total+q.shipping_fee,'slip_submitted',q.slip_path is not null,'items',q.items
  ) order by q.created_at desc),'[]'::jsonb)
  into v_orders
  from (
    select o.id,o.order_number,o.created_at,o.status,o.payment_method,o.total,o.shipping_fee,o.slip_path,
      (select coalesce(jsonb_agg(jsonb_build_object('book_title',i.book_title,'unit_price',i.unit_price,'quantity',i.quantity) order by i.id),'[]'::jsonb)
        from public.order_items i where i.order_id=o.id) as items
    from public.orders o
    where regexp_replace(o.phone,'[^0-9]','','g')=v_phone
    order by o.created_at desc
  ) q;
  if jsonb_array_length(v_orders)=0 then raise exception 'ไม่พบคำสั่งซื้อจากเบอร์นี้ กรุณาตรวจสอบเบอร์โทรศัพท์'; end if;
  return v_orders;
end;
$$;
revoke all on function public.get_customer_orders_by_phone(text) from public;
grant execute on function public.get_customer_orders_by_phone(text) to anon, authenticated;

create or replace function public.get_book_reservation_status(p_book_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'awaiting_payment',coalesce(sum(i.quantity) filter(where o.status='awaiting_payment'),0)::integer,
    'slip_submitted',coalesce(sum(i.quantity) filter(where o.status='slip_submitted'),0)::integer,
    'other_pending',coalesce(sum(i.quantity) filter(where o.status in ('pending','contacted')),0)::integer
  )
  from public.order_items i join public.orders o on o.id=i.order_id
  where i.book_id=p_book_id and o.status in ('pending','contacted','awaiting_payment','slip_submitted')
    and exists (select 1 from public.books b where b.id=p_book_id and b.status='published');
$$;
revoke all on function public.get_book_reservation_status(uuid) from public;
grant execute on function public.get_book_reservation_status(uuid) to anon, authenticated;

create or replace function public.submit_order_payment_slip(p_order_id uuid,p_order_number text,p_phone text,p_slip_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from storage.objects where bucket_id='payment-slips' and name=p_slip_path) then
    raise exception 'ไม่พบไฟล์สลิปที่อัปโหลด';
  end if;
  update public.orders set slip_path=p_slip_path,status='slip_submitted'
  where id=p_order_id and order_number=upper(trim(coalesce(p_order_number,'')))
    and regexp_replace(phone,'[^0-9]','','g')=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')
    and payment_method='qr' and status in ('awaiting_payment','slip_submitted')
    and p_slip_path like p_order_id::text || '/%' and p_slip_path !~ '\.\.';
  if not found then raise exception 'ไม่สามารถส่งสลิปสำหรับคำสั่งซื้อนี้ได้ กรุณาตรวจสถานะออเดอร์'; end if;
end;
$$;
revoke all on function public.submit_order_payment_slip(uuid,text,text,text) from public;
grant execute on function public.submit_order_payment_slip(uuid,text,text,text) to anon, authenticated;

create or replace function public.update_order_workflow(p_order_id uuid,p_status text,p_shipping_fee numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  if not (select public.is_book_admin()) then raise exception 'เฉพาะเจ้าของร้านเท่านั้น'; end if;
  if p_status not in ('pending','contacted','awaiting_payment','slip_submitted','confirmed','shipped','completed','cancelled') then raise exception 'สถานะคำสั่งซื้อไม่ถูกต้อง'; end if;
  if p_shipping_fee is null or p_shipping_fee < 0 or p_shipping_fee > 100000 then raise exception 'กรุณากรอกค่าส่งตั้งแต่ 0 ถึง 100,000 บาท'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'ไม่พบคำสั่งซื้อ'; end if;
  if v_order.status='cancelled' and p_status<>'cancelled' then raise exception 'คำสั่งซื้อที่ยกเลิกแล้วไม่สามารถเปิดใหม่ได้'; end if;
  if v_order.status='completed' and p_status<>'completed' then raise exception 'คำสั่งซื้อที่ปิดแล้วไม่สามารถแก้ไขสถานะได้'; end if;
  if p_status='completed' and v_order.status not in ('confirmed','shipped') then raise exception 'กรุณายืนยันการชำระหรือจัดส่งก่อนปิดคำสั่งซื้อ'; end if;
  if p_status in ('awaiting_payment','slip_submitted') and v_order.payment_method<>'qr' then raise exception 'คำสั่งซื้อนี้ไม่ได้เลือกชำระด้วย QR'; end if;
  if p_status='awaiting_payment' and not exists(select 1 from public.shop_payment_settings where id and qr_image_url<>'') then raise exception 'กรุณาเพิ่ม QR รับเงินในหลังร้านก่อน'; end if;
  if v_order.status<>'cancelled' and p_status='cancelled' then
    for v_item in select book_id,quantity from public.order_items where order_id=p_order_id and book_id is not null order by book_id loop
      update public.books set stock=stock+v_item.quantity where id=v_item.book_id;
    end loop;
  end if;
  update public.orders set status=p_status,shipping_fee=p_shipping_fee where id=p_order_id;
end;
$$;
revoke all on function public.update_order_workflow(uuid,text,numeric) from public;
grant execute on function public.update_order_workflow(uuid,text,numeric) to authenticated;

create or replace function public.update_book_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_item record;
begin
  if not (select public.is_book_admin()) then raise exception 'เฉพาะเจ้าของร้านเท่านั้น'; end if;
  if p_status not in ('pending','contacted','confirmed','shipped','completed','cancelled') then raise exception 'สถานะคำสั่งซื้อไม่ถูกต้อง'; end if;
  select status into v_status from public.orders where id = p_order_id for update;
  if not found then raise exception 'ไม่พบคำสั่งซื้อ'; end if;
  if v_status = 'cancelled' and p_status <> 'cancelled' then raise exception 'คำสั่งซื้อที่ยกเลิกแล้วไม่สามารถเปิดใหม่ได้'; end if;
  if v_status = 'completed' and p_status <> 'completed' then raise exception 'คำสั่งซื้อที่ปิดแล้วไม่สามารถแก้ไขสถานะได้'; end if;
  if p_status = 'completed' and v_status not in ('confirmed','shipped') then raise exception 'กรุณายืนยันการชำระหรือจัดส่งก่อนปิดคำสั่งซื้อ'; end if;
  if v_status <> 'cancelled' and p_status = 'cancelled' then
    for v_item in select book_id, quantity from public.order_items where order_id = p_order_id and book_id is not null order by book_id loop
      update public.books set stock = stock + v_item.quantity where id = v_item.book_id;
    end loop;
  end if;
update public.orders set status = p_status where id = p_order_id;
end;
$$;
revoke all on function public.update_book_order_status(uuid,text) from public;
grant execute on function public.update_book_order_status(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
