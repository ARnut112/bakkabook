-- Run AFTER orders.sql. No existing orders are sent to LINE during installation.
begin;

-- Private outbox: network failures never undo a customer's slip submission.
create table if not exists public.line_order_notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  slip_path text not null,
  state text not null default 'pending' check (state in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  first_attempt_at timestamptz,
  sent_at timestamptz,
  payload jsonb,
  recipient text,
  amount numeric(10, 2),
  last_error text,
  created_at timestamptz not null default now()
);
create table if not exists public.line_payment_audit (
  event_id text primary key,
  notification_id uuid not null references public.line_order_notifications(id),
  order_id uuid not null references public.orders(id),
  admin_user_id text not null,
  confirmed_at timestamptz not null default now()
);
alter table public.line_order_notifications enable row level security;
alter table public.line_payment_audit enable row level security;
revoke all on public.line_order_notifications, public.line_payment_audit from public, anon, authenticated;
grant all on public.line_order_notifications, public.line_payment_audit to service_role;

create or replace function public.queue_line_payment_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'slip_submitted' and new.slip_path is not null
     and (old.slip_path is distinct from new.slip_path or old.status is distinct from new.status) then
    insert into public.line_order_notifications (order_id, slip_path)
    values (new.id, new.slip_path)
    on conflict (order_id) do update set slip_path = excluded.slip_path
      where line_order_notifications.attempts = 0 and line_order_notifications.state = 'pending'
        and line_order_notifications.payload is null;
  end if;
  return new;
end;
$$;
revoke all on function public.queue_line_payment_notification() from public, anon, authenticated;
drop trigger if exists queue_line_payment_notification on public.orders;
create trigger queue_line_payment_notification after update of status, slip_path on public.orders
for each row execute function public.queue_line_payment_notification();

-- A lease and SKIP LOCKED prevent overlapping webhook/cron calls from sending twice.
create or replace function public.claim_line_notification()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.line_order_notifications%rowtype;
begin
  -- LINE retry keys expire after 24h. Stop earlier instead of risking a duplicate.
  update public.line_order_notifications set state = 'failed', last_error = 'retry_window_expired'
  where state in ('pending', 'sending')
    and first_attempt_at < now() - interval '23 hours';
  update public.line_order_notifications set state = 'failed', last_error = 'retry_limit_reached'
  where state in ('pending', 'sending') and available_at <= now() and attempts >= 6;
  select * into v_job from public.line_order_notifications
  where state in ('pending', 'sending') and available_at <= now() and attempts < 6
  order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.line_order_notifications
  set state = 'sending', attempts = attempts + 1,
      first_attempt_at = coalesce(first_attempt_at, now()), available_at = now() + interval '2 minutes'
  where id = v_job.id returning * into v_job;
  return to_jsonb(v_job);
end;
$$;
revoke all on function public.claim_line_notification() from public, anon, authenticated;
grant execute on function public.claim_line_notification() to service_role;

-- Only the server can call this RPC, after verifying LINE's signature and admin ID.
-- Compare the exact slip and amount from the notification, then lock and confirm once.
create or replace function public.confirm_line_payment(
  p_notification_id uuid, p_admin_user_id text, p_event_id text
)
returns text language plpgsql security definer set search_path = '' as $$
declare v_job public.line_order_notifications%rowtype; v_order public.orders%rowtype;
begin
  select * into v_job from public.line_order_notifications where id = p_notification_id;
  if not found or v_job.recipient is distinct from p_admin_user_id or v_job.payload is null then
    return 'not_found';
  end if;
  select * into v_order from public.orders where id = v_job.order_id for update;
  if not found then return 'not_found'; end if;
  if exists (select 1 from public.line_payment_audit where event_id = p_event_id) then
    return 'already_confirmed';
  end if;
  if v_order.status in ('confirmed', 'shipped', 'completed') then return 'already_confirmed'; end if;
  if v_order.status <> 'slip_submitted' or v_order.payment_method <> 'qr'
     or v_order.slip_path is distinct from v_job.slip_path
     or (v_order.total + v_order.shipping_fee) is distinct from v_job.amount then
    return 'changed';
  end if;
  update public.orders set status = 'confirmed' where id = v_order.id;
  insert into public.line_payment_audit (event_id, notification_id, order_id, admin_user_id)
  values (p_event_id, v_job.id, v_order.id, p_admin_user_id);
  return 'confirmed';
end;
$$;
revoke all on function public.confirm_line_payment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.confirm_line_payment(uuid, text, text) to service_role;
commit;
