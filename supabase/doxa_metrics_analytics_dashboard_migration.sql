-- Doxa analytics dashboard migration (additive only)
-- Run this in the Supabase SQL editor on your EXISTING metrics project.
-- Safe for live data: no DROP TABLE, no truncate. Existing wallet/transaction rows are kept.
--
-- What this adds:
--   - amount_usd, platform_fee_usd on doxa_wallet_transactions
--   - doxa_app_downloads table (for Uptodown / store download snapshots later)
--   - updated aggregate views including USD volume/fees
--
-- DOXA_UPTODOWN_APP_URL is optional. Skip it until the app is on Uptodown;
-- you can still record download counts manually from the dashboard later.

alter table public.doxa_wallet_transactions
  add column if not exists amount_usd numeric,
  add column if not exists platform_fee_usd numeric;

create index if not exists doxa_wallet_transactions_amount_usd_idx
  on public.doxa_wallet_transactions (amount_usd)
  where amount_usd is not null;

create index if not exists doxa_wallet_transactions_platform_fee_usd_idx
  on public.doxa_wallet_transactions (platform_fee_usd)
  where platform_fee_usd is not null;

-- Backfill USD for known stablecoin rows where possible (USDC/USDT ≈ $1).
update public.doxa_wallet_transactions
set amount_usd = amount_numeric
where amount_usd is null
  and amount_numeric is not null
  and upper(coalesce(token_symbol, '')) in ('USDC', 'USDT', 'DAI', 'BUSD');

update public.doxa_wallet_transactions
set platform_fee_usd = nullif(
  regexp_replace(coalesce(platform_fee_text, ''), '[^0-9.\\-]', '', 'g'),
  ''
)::numeric
where platform_fee_usd is null
  and platform_fee_text is not null
  and platform_fee_text ~ '[0-9]'
  and (
    upper(coalesce(token_symbol, '')) in ('USDC', 'USDT', 'DAI', 'BUSD')
    or upper(platform_fee_text) ~ '(USDC|USDT|DAI|BUSD|USD)'
  );

create table if not exists public.doxa_app_downloads (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('uptodown', 'play_store', 'app_store', 'apk', 'other')),
  download_count bigint not null check (download_count >= 0),
  delta_count bigint,
  app_url text,
  recorded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists doxa_app_downloads_source_recorded_at_idx
  on public.doxa_app_downloads (source, recorded_at desc);

alter table public.doxa_app_downloads enable row level security;
revoke all on public.doxa_app_downloads from anon, authenticated;
grant select, insert, update on public.doxa_app_downloads to service_role;

drop policy if exists doxa_app_downloads_service_role_manage on public.doxa_app_downloads;
create policy doxa_app_downloads_service_role_manage
on public.doxa_app_downloads
for all
to service_role
using (true)
with check (true);

drop trigger if exists set_doxa_app_downloads_updated_at on public.doxa_app_downloads;
create trigger set_doxa_app_downloads_updated_at
before update on public.doxa_app_downloads
for each row execute function public.set_doxa_metrics_updated_at();

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
group by 1, 2, 3, 4, 5;

create or replace view public.doxa_transaction_status_summary as
select
  category,
  network_id,
  status,
  count(*)::bigint as transaction_count,
  coalesce(sum(amount_numeric), 0) as token_volume,
  coalesce(sum(amount_usd), 0) as volume_usd,
  coalesce(sum(platform_fee_usd), 0) as fee_usd
from public.doxa_wallet_transactions
group by 1, 2, 3;

create or replace view public.doxa_latest_downloads_by_source as
select distinct on (source)
  source,
  download_count,
  delta_count,
  app_url,
  recorded_at,
  metadata
from public.doxa_app_downloads
order by source, recorded_at desc;

grant select on public.doxa_daily_transaction_volume to service_role;
grant select on public.doxa_transaction_status_summary to service_role;
grant select on public.doxa_latest_downloads_by_source to service_role;
