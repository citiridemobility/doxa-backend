-- Exclude failed/cancelled txs from daily volume view (safe to re-run).
create or replace view public.doxa_daily_transaction_volume as
select
  date_trunc('day', occurred_at)::date as day,
  category,
  network_id,
  network_label,
  token_symbol,
  count(*)::bigint as transaction_count,
  coalesce(sum(amount_numeric), 0) as token_volume,
  coalesce(sum(amount_usd), 0) as volume_usd,
  coalesce(sum(platform_fee_usd), 0) as fee_usd
from public.doxa_wallet_transactions
where lower(coalesce(status, 'completed')) not in ('failed', 'cancelled', 'canceled')
group by 1, 2, 3, 4, 5;

revoke all on public.doxa_daily_transaction_volume from anon, authenticated;
grant select on public.doxa_daily_transaction_volume to service_role;
