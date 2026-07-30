-- Doxa Wallet Supabase metrics schema
-- Run this in the Supabase SQL Editor for the dedicated Doxa analytics project.
-- This stores public analytics metadata only. Never store seed phrases, private keys, passwords, or encrypted wallet payloads here.

create extension if not exists pgcrypto;

create table if not exists public.doxa_wallet_creations (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  source text not null default 'created' check (source in ('created', 'imported', 'imported_seed', 'imported_private_key', 'recovered', 'unknown')),
  is_backed_up boolean,
  platform text,
  app_version text,
  client_created_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint doxa_wallet_creations_wallet_address_format check (wallet_address ~* '^0x[a-f0-9]{40}$'),
  constraint doxa_wallet_creations_wallet_address_unique unique (wallet_address)
);

create table if not exists public.doxa_wallet_transactions (
  event_id text primary key,
  wallet_address text not null,
  tx_hash text,
  category text not null default 'transaction' check (category in ('transaction', 'token-transfer', 'swap', 'bridge', 'xchange', 'bills')),
  status text not null default 'completed' check (status in ('pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled')),
  direction text check (direction in ('sent', 'received')),
  network_id text,
  network_label text,
  token_symbol text,
  token_address text,
  amount_text text,
  amount_numeric numeric,
  fiat_amount_text text,
  platform_fee_text text,
  provider text,
  counterparty text,
  reference text,
  explorer_url text,
  source text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint doxa_wallet_transactions_wallet_address_format check (wallet_address ~* '^0x[a-f0-9]{40}$'),
  constraint doxa_wallet_transactions_tx_hash_format check (tx_hash is null or tx_hash ~* '^0x[a-f0-9]{64}$'),
  constraint doxa_wallet_transactions_token_address_format check (token_address is null or token_address ~* '^0x[a-f0-9]{40}$')
);

create index if not exists doxa_wallet_creations_created_at_idx on public.doxa_wallet_creations (created_at desc);
create index if not exists doxa_wallet_creations_source_idx on public.doxa_wallet_creations (source);

create index if not exists doxa_wallet_transactions_wallet_idx on public.doxa_wallet_transactions (wallet_address);
create index if not exists doxa_wallet_transactions_hash_idx on public.doxa_wallet_transactions (tx_hash) where tx_hash is not null;
create index if not exists doxa_wallet_transactions_category_idx on public.doxa_wallet_transactions (category);
create index if not exists doxa_wallet_transactions_network_idx on public.doxa_wallet_transactions (network_id);
create index if not exists doxa_wallet_transactions_occurred_at_idx on public.doxa_wallet_transactions (occurred_at desc);
create index if not exists doxa_wallet_transactions_volume_idx on public.doxa_wallet_transactions (category, network_id, occurred_at desc);

alter table public.doxa_wallet_creations enable row level security;
alter table public.doxa_wallet_transactions enable row level security;

revoke all on public.doxa_wallet_creations from anon, authenticated;
revoke all on public.doxa_wallet_transactions from anon, authenticated;

grant select, insert, update on public.doxa_wallet_creations to service_role;
grant select, insert, update on public.doxa_wallet_transactions to service_role;

drop policy if exists doxa_wallet_creations_service_role_manage on public.doxa_wallet_creations;
create policy doxa_wallet_creations_service_role_manage
on public.doxa_wallet_creations
for all
to service_role
using (true)
with check (true);

drop policy if exists doxa_wallet_transactions_service_role_manage on public.doxa_wallet_transactions;
create policy doxa_wallet_transactions_service_role_manage
on public.doxa_wallet_transactions
for all
to service_role
using (true)
with check (true);

create or replace function public.set_doxa_metrics_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_doxa_wallet_creations_updated_at on public.doxa_wallet_creations;
create trigger set_doxa_wallet_creations_updated_at
before update on public.doxa_wallet_creations
for each row execute function public.set_doxa_metrics_updated_at();

drop trigger if exists set_doxa_wallet_transactions_updated_at on public.doxa_wallet_transactions;
create trigger set_doxa_wallet_transactions_updated_at
before update on public.doxa_wallet_transactions
for each row execute function public.set_doxa_metrics_updated_at();

create or replace view public.doxa_daily_wallet_creations as
select
  date_trunc('day', created_at)::date as day,
  source,
  platform,
  count(*)::bigint as wallets_created
from public.doxa_wallet_creations
group by 1, 2, 3;

create or replace view public.doxa_daily_transaction_volume as
select
  date_trunc('day', occurred_at)::date as day,
  category,
  network_id,
  network_label,
  token_symbol,
  count(*)::bigint as transaction_count,
  coalesce(sum(amount_numeric), 0) as token_volume
from public.doxa_wallet_transactions
group by 1, 2, 3, 4, 5;

create or replace view public.doxa_transaction_status_summary as
select
  category,
  network_id,
  status,
  count(*)::bigint as transaction_count,
  coalesce(sum(amount_numeric), 0) as token_volume
from public.doxa_wallet_transactions
group by 1, 2, 3;

revoke all on public.doxa_daily_wallet_creations from anon, authenticated;
revoke all on public.doxa_daily_transaction_volume from anon, authenticated;
revoke all on public.doxa_transaction_status_summary from anon, authenticated;

grant select on public.doxa_daily_wallet_creations to service_role;
grant select on public.doxa_daily_transaction_volume to service_role;
grant select on public.doxa_transaction_status_summary to service_role;
