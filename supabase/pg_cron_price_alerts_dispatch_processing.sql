-- Second pg_cron migration for Doxa price alert dispatch queue processing.
-- Run this after pg_cron_price_alerts_schedule.sql.

create or replace function public.claim_doxa_price_alerts_dispatch()
returns table (
  id bigint,
  created_at timestamptz,
  payload jsonb
)
language plpgsql
as $$
begin
  return query
  select q.id, q.created_at, q.payload
  from public.doxa_price_alerts_dispatch_queue q
  where q.processed = false
  order by q.created_at asc
  for update skip locked
  limit 1;
end;
$$;

create or replace function public.complete_doxa_price_alerts_dispatch(dispatch_id bigint)
returns void
language plpgsql
as $$
begin
  update public.doxa_price_alerts_dispatch_queue
  set processed = true,
      processed_at = now()
  where id = dispatch_id;
end;
$$;

-- Grant access to service_role for backend processing.
grant select, update on public.doxa_price_alerts_dispatch_queue to service_role;
grant execute on function public.claim_doxa_price_alerts_dispatch() to service_role;
grant execute on function public.complete_doxa_price_alerts_dispatch(bigint) to service_role;

drop policy if exists doxa_price_alerts_dispatch_queue_service_role_access on public.doxa_price_alerts_dispatch_queue;
create policy doxa_price_alerts_dispatch_queue_service_role_access
on public.doxa_price_alerts_dispatch_queue
for all
to service_role
using (true)
with check (true);
