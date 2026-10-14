const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
test('shipping permissions, customer receipt and tracking data', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create table orders(id uuid primary key,order_number text,phone text,status text,
        payment_method text default 'qr',total numeric default 220,shipping_fee numeric default 0,
        slip_path text,created_at timestamptz default now());
      create table order_items(id uuid,order_id uuid,book_title text,unit_price numeric,quantity int);
      create function is_book_admin() returns boolean language sql as
      $$ select coalesce(current_setting('test.admin',true),'false') = 'true' $$;`);
    const sql = fs.readFileSync(path.join(__dirname, '../supabase/shipping.sql'), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    const id = randomUUID();
    await db.query(
      "insert into orders(id,order_number,phone,status) values($1,'BK-TEST','0812345678','pending')",
      [id],
    );
    const ship = (carrier = 'Flash', number = 'TH123') =>
      db.query('select save_order_shipping($1,$2,$3)', [id, carrier, number]);
    const receive = (phone = '0812345678') =>
      db.query("select confirm_order_received($1,'BK-TEST',$2)", [id, phone]);
    await db.exec('set role anon');
    await assert.rejects(ship(), /permission denied/);
    await assert.rejects(receive(), /จัดส่ง/);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(ship(), /เจ้าของร้าน/);
    await db.exec("reset role; set test.admin='true'");
    await assert.rejects(ship(), /ยืนยันการชำระ/);
    await db.query("update orders set status='confirmed' where id=$1", [id]);
    await assert.rejects(ship('', ''), /กรอก/);
    await ship();
    await db.exec('set role anon');
    await assert.rejects(receive('0899999999'), /ไม่พบคำสั่งซื้อ/);
    const rows = (await db.query("select get_customer_orders_by_phone('0812345678') as orders"))
      .rows[0].orders;
    assert.equal(rows[0].carrier, 'Flash');
    assert.equal(rows[0].tracking_number, 'TH123');
    await receive();
    await receive();
    await db.exec('reset role');
    const result = (await db.query('select * from orders where id=$1', [id])).rows[0];
    assert.equal(result.status, 'completed');
    assert(result.received_at);
    assert(result.shipped_at);
    await assert.rejects(ship(), /ยืนยันการชำระ/);
  } finally {
    await db.close();
  }
});
