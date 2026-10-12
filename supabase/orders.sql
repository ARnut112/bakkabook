-- Run once in the SQL Editor for the shop's existing database.
begin;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_name text not null check (char_length(trim(customer_name)) between 2 and 100),
  phone text not null check (char_length(trim(phone)) between 8 and 20),
  address text not null check (char_length(trim(address)) between 5 and 1000),
  note text not null default '' check (char_length(note) <= 500),
  total numeric(10,2) not null check (total >= 0),
  status text not null default 'pending' check (status in ('pending','confirmed','shipped','cancelled')),
  created_at timestamptz not null default now()
);

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

create or replace function public.create_book_order(
  p_customer_name text,
  p_phone text,
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
  insert into public.orders(order_number,customer_name,phone,address,note,total)
    values (v_order_number,trim(p_customer_name),trim(p_phone),trim(p_address),trim(coalesce(p_note,'')),v_total)
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
revoke all on function public.create_book_order(text,text,text,text,jsonb) from public;
grant execute on function public.create_book_order(text,text,text,text,jsonb) to anon, authenticated;

create or replace function public.update_book_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_item record;
begin
  if not (select public.is_book_admin()) then raise exception 'เฉพาะเจ้าของร้านเท่านั้น'; end if;
  if p_status not in ('pending','confirmed','shipped','cancelled') then raise exception 'สถานะคำสั่งซื้อไม่ถูกต้อง'; end if;
  select status into v_status from public.orders where id = p_order_id for update;
  if not found then raise exception 'ไม่พบคำสั่งซื้อ'; end if;
  if v_status = 'cancelled' and p_status <> 'cancelled' then raise exception 'คำสั่งซื้อที่ยกเลิกแล้วไม่สามารถเปิดใหม่ได้'; end if;
  if v_status <> 'cancelled' and p_status = 'cancelled' then
    for v_item in select book_id, quantity from public.order_items where order_id = p_order_id and book_id is not null loop
      update public.books set stock = stock + v_item.quantity where id = v_item.book_id;
    end loop;
  end if;
  update public.orders set status = p_status where id = p_order_id;
end;
$$;
revoke all on function public.update_book_order_status(uuid,text) from public;
grant execute on function public.update_book_order_status(uuid,text) to authenticated;

commit;
