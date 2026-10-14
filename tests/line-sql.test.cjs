const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sql = fs.readFileSync(path.join(__dirname, '../supabase/line-orders.sql'), 'utf8');

test('LINE migration and payment transitions run against an isolated PostgreSQL database', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create table public.orders (id uuid primary key, status text, slip_path text,
        total numeric(10,2), shipping_fee numeric(10,2), payment_method text);
    `);
    await db.exec(sql);
    await db.exec(sql); // Repeatable install.
    const value = async (query, args = []) => (await db.query(query, args)).rows[0]?.value;
    async function order(status = 'awaiting_payment') {
      const id = randomUUID();
      await db.query("insert into orders values ($1,$2,null,220,0,'qr')", [id, status]);
      return id;
    }
    async function slip(id, file = 'slip.jpg') {
      await db.query("update orders set status='slip_submitted', slip_path=$2 where id=$1", [
        id,
        id + '/' + file,
      ]);
      return (await db.query('select * from line_order_notifications where order_id=$1', [id]))
        .rows[0];
    }
    async function prepared(id) {
      const job = await slip(id);
      await db.query(
        "update line_order_notifications set payload='{}',recipient='admin',amount=220,attempts=1 where id=$1",
        [job.id],
      );
      return job.id;
    }
    const confirm = (id, user = 'admin', event = randomUUID()) =>
      value('select confirm_line_payment($1,$2,$3) as value', [id, user, event]);

    await t.test('only slip submissions queue work, one notification per order', async () => {
      const id = await order();
      assert.equal(await value('select count(*)::int as value from line_order_notifications'), 0);
      const first = await slip(id);
      const again = await slip(id, 'new.png');
      assert.equal(first.id, again.id);
      assert.equal(again.slip_path, id + '/new.png');
      await db.query("update orders set status='confirmed' where id=$1", [id]);
      assert.equal(await value('select count(*)::int as value from line_order_notifications'), 1);
      await db.exec("update line_order_notifications set state='skipped'");
    });
    await t.test(
      'lease excludes duplicate dispatch and freezes the slip after first claim',
      async () => {
        const id = await order();
        const job = await slip(id);
        const first = await value('select claim_line_notification() as value');
        assert.equal(first.id, job.id);
        assert.equal(first.attempts, 1);
        assert.equal(await value('select claim_line_notification() as value'), null);
        await slip(id, 'replacement.jpg');
        assert.equal(
          await value('select slip_path as value from line_order_notifications where id=$1', [
            job.id,
          ]),
          id + '/slip.jpg',
        );
        await db.exec("update line_order_notifications set state='skipped'");
      },
    );
    await t.test('confirmation updates once and creates exactly one audit entry', async () => {
      const id = await order();
      const job = await prepared(id);
      assert.equal(await confirm(job, 'other'), 'not_found');
      assert.equal(await confirm(job), 'confirmed');
      assert.equal(await confirm(job), 'already_confirmed');
      assert.equal(
        await value('select status as value from orders where id=$1', [id]),
        'confirmed',
      );
      assert.equal(
        await value('select count(*)::int as value from line_payment_audit where order_id=$1', [
          id,
        ]),
        1,
      );
    });
    await t.test('old slip, changed amount and cancelled order cannot be approved', async () => {
      for (const change of ["slip_path='different.jpg'", 'total=999', "status='cancelled'"]) {
        const id = await order();
        const job = await prepared(id);
        await db.query('update orders set ' + change + ' where id=$1', [id]);
        assert.equal(await confirm(job), 'changed');
      }
    });
    await t.test(
      'browser roles cannot read the queue, audit or call confirmation/dispatch RPCs',
      async () => {
        for (const role of ['anon', 'authenticated']) {
          await db.exec('set role ' + role);
          for (const query of [
            'select * from line_order_notifications',
            'select * from line_payment_audit',
            'select claim_line_notification()',
            `select confirm_line_payment('${randomUUID()}','admin','event')`,
          ]) {
            await assert.rejects(db.query(query), /permission denied/);
          }
          await db.exec('reset role');
        }
      },
    );
    await t.test(
      'expired retry windows and exhausted attempts stop instead of duplicating messages',
      async () => {
        await db.exec("update line_order_notifications set state='skipped'");
        const id = await order();
        const job = await slip(id);
        await db.query(
          "update line_order_notifications set first_attempt_at=now()-interval '24 hours' where id=$1",
          [job.id],
        );
        assert.equal(await value('select claim_line_notification() as value'), null);
        assert.equal(
          await value('select state as value from line_order_notifications where id=$1', [job.id]),
          'failed',
        );
      },
    );
  } finally {
    await db.close();
  }
});
