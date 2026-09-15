-- Per-person integration credentials.
--
-- Architecture for Phase 3, created now so the shape is settled and tested
-- before any real token exists. NOTHING WRITES TO THIS TABLE YET.
--
-- Why it exists: the Gmail and Calendar adapters currently read a single
-- refresh token from the environment, which would make both agents act as one
-- Google identity — Brady's session would read Jamie's mailbox. Jamie's tokens
-- must belong to Jamie's profile. This table is that ownership.
--
-- Note the distinction from `integration_connections`:
--   * integration_connections — one row per vendor, describing whether the
--     product as a whole is wired up to Cloze/Gmail/MLS. Team-visible.
--   * integration_accounts    — one row per person per vendor, holding that
--     person's credentials. Visible only to its owner, and its token columns
--     are readable by no user role at all.

create table if not exists public.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('google', 'cloze', 'activepipe', 'docusign')),

  -- Which account was connected, for display ("Connected as jamie@...").
  account_email text,
  status text not null default 'disconnected'
    check (status in ('connected', 'disconnected', 'error', 'revoked')),
  scopes text[] not null default '{}',

  -- Credentials. Encrypted by the application before they are written; the
  -- database never sees a usable plaintext token. Read server-side with the
  -- service role only — see the grants below, which deny these columns to every
  -- user-facing role so a token cannot leak through an ordinary query.
  access_token text,
  refresh_token text,
  access_token_expires_at timestamptz,

  connected_at timestamptz,
  last_refreshed_at timestamptz,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One connection per person per vendor.
  unique (profile_id, provider)
);

create index if not exists integration_accounts_profile_idx on public.integration_accounts (profile_id);

drop trigger if exists integration_accounts_touch on public.integration_accounts;
create trigger integration_accounts_touch
  before update on public.integration_accounts
  for each row execute function public.touch_updated_at();

/* ------------------------------------------------------------------ access */

alter table public.integration_accounts enable row level security;

-- Unlike every other table, this one is NOT team-wide. A connection belongs to
-- one person. Being an approved team member is necessary but not sufficient.
drop policy if exists integration_accounts_select on public.integration_accounts;
create policy integration_accounts_select on public.integration_accounts
  for select to authenticated
  using (public.is_team_member() and profile_id = public.current_profile_id());

drop policy if exists integration_accounts_insert on public.integration_accounts;
create policy integration_accounts_insert on public.integration_accounts
  for insert to authenticated
  with check (public.is_team_member() and profile_id = public.current_profile_id());

drop policy if exists integration_accounts_update on public.integration_accounts;
create policy integration_accounts_update on public.integration_accounts
  for update to authenticated
  using (public.is_team_member() and profile_id = public.current_profile_id())
  with check (public.is_team_member() and profile_id = public.current_profile_id());

-- Disconnecting is deleting your own row.
drop policy if exists integration_accounts_delete on public.integration_accounts;
create policy integration_accounts_delete on public.integration_accounts
  for delete to authenticated
  using (public.is_team_member() and profile_id = public.current_profile_id());

-- Column privileges: no user-facing role may read or write the credential
-- columns, even for its own row. Tokens are handled exclusively by server-side
-- code holding the service role, so they can never be returned to a browser by
-- an ordinary `select *`.
revoke all on public.integration_accounts from anon, authenticated;

grant select (
  id, profile_id, provider, account_email, status, scopes,
  access_token_expires_at, connected_at, last_refreshed_at, last_error,
  created_at, updated_at
) on public.integration_accounts to authenticated;

grant insert (profile_id, provider, account_email, status, scopes) on public.integration_accounts to authenticated;
grant update (account_email, status, scopes) on public.integration_accounts to authenticated;
grant delete on public.integration_accounts to authenticated;
