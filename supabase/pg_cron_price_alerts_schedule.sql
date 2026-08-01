-- pg_cron schedule for Doxa price alert dispatch
-- Run this migration in your Supabase SQL editor or via your migration workflow.

create extension if not exists pg_cron;

create table if not exists public.doxa_price_alerts_dispatch_queue (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  processed boolean not null default false,
  processed_at timestamptz,
  payload jsonb not null default '{"source":"pg_cron"}'::jsonb
);

alter table public.doxa_price_alerts_dispatch_queue enable row level security;
revoke all on public.doxa_price_alerts_dispatch_queue from anon, authenticated;
grant select, insert, update on public.doxa_price_alerts_dispatch_queue to service_role;

create policy doxa_price_alerts_dispatch_queue_service_role_manage
on public.doxa_price_alerts_dispatch_queue
for all
to service_role
using (true)
with check (true);

create or replace function public.enqueue_doxa_price_alerts_dispatch()
returns void
language sql
as $$
insert into public.doxa_price_alerts_dispatch_queue (payload)
values ('{"source":"pg_cron"}'::jsonb);
$$;

-- Ensure a single scheduled job exists for this task.
-- If a previous schedule already exists with the same name, unschedule it first.
select cron.unschedule('doxa_price_alerts_dispatch')
where exists (
  select 1 from cron.job where jobname = 'doxa_price_alerts_dispatch'
);

select cron.schedule(
  'doxa_price_alerts_dispatch',
  '0 * * * *',
  $$select public.enqueue_doxa_price_alerts_dispatch();$$
);
