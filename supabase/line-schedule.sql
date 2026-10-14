-- Optional automatic retries. Run after line-orders.sql and deploying both functions.
-- First enable pg_cron and pg_net in Supabase, and save these in Supabase Vault:
-- bakkabook_project_url = your https://PROJECT.supabase.co URL
-- This script creates bakkabook_line_notify_secret in Vault if missing.
-- Copy its value in the Vault UI to Edge Functions Secrets as LINE_NOTIFY_SECRET.
-- No database service-role key is sent with these requests.
-- Vault is separate from Edge Function Secrets. Do not put keys in this file.
begin;
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'Enable pg_cron and pg_net in Supabase first';
  end if;
  if (select count(*) from vault.decrypted_secrets where name = 'bakkabook_project_url') <> 1 then
    raise exception 'Add bakkabook_project_url in Vault first';
  end if;
  -- Keep the same key on reruns. Two random UUIDs provide over 240 random bits.
  if not exists (select 1 from vault.decrypted_secrets where name = 'bakkabook_line_notify_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'bakkabook_line_notify_secret', 'Private credential for the LINE notification dispatcher'
    );
  end if;
end;
$$;
-- An existing job with this name is updated, so rerunning does not create duplicates.
select cron.schedule('bakkabook-line-notifications', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'bakkabook_project_url') || '/functions/v1/line-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-line-notify-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bakkabook_line_notify_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  )
  where exists (
    select 1 from public.line_order_notifications
    where state in ('pending', 'sending') and available_at <= now()
  );
$job$);
commit;
