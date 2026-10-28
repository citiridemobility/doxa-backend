-- Doxa Xchange customer KYC state.
-- Apply this migration in the same Supabase project used by the Doxa backend.
-- It deliberately stores only the Didit session reference and decision state. Identity
-- document data remains with Didit and is retrieved server-to-server only when a
-- Paycrest on-ramp order needs its required source.kyc payload.

create table if not exists public.doxa_xchange_kyc_verifications (
  wallet_address text primary key,
  didit_session_id text not null unique,
  status text not null default 'pending' check (status in ('pending', 'in_review', 'approved', 'declined')),
  consent_at timestamptz not null,
  verified_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint doxa_xchange_kyc_wallet_address_format check (wallet_address ~* '^0x[a-f0-9]{40}$')
);

create index if not exists doxa_xchange_kyc_status_idx
  on public.doxa_xchange_kyc_verifications (status, updated_at desc);

alter table public.doxa_xchange_kyc_verifications enable row level security;
revoke all on public.doxa_xchange_kyc_verifications from anon, authenticated;
grant select, insert, update on public.doxa_xchange_kyc_verifications to service_role;

drop policy if exists doxa_xchange_kyc_service_role_manage on public.doxa_xchange_kyc_verifications;
create policy doxa_xchange_kyc_service_role_manage
on public.doxa_xchange_kyc_verifications
for all
to service_role
using (true)
with check (true);

create or replace function public.set_doxa_xchange_kyc_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_doxa_xchange_kyc_updated_at on public.doxa_xchange_kyc_verifications;
create trigger set_doxa_xchange_kyc_updated_at
before update on public.doxa_xchange_kyc_verifications
for each row execute function public.set_doxa_xchange_kyc_updated_at();
