-- =============================================================================
-- 0006 — make allowlist matching immune to stray whitespace.
--
-- Migration 0003 stored allowlist addresses with `check (email = lower(email))`
-- and `handle_new_user` matched with `a.email = lower(new.email)`. Case was
-- therefore handled, but whitespace was not: an address pasted into the SQL
-- editor with a trailing space, or with a non-breaking space picked up from a
-- web page or a document, satisfied the constraint, sat in the table looking
-- correct, and silently failed to approve the account it was meant to approve.
--
-- This was found in production bootstrapping: one of two addresses entered in
-- the same statement approved and the other did not.
--
-- The fix is to store and compare a canonical form with all whitespace removed.
-- Note what this deliberately does NOT do: it does not ignore dots, plus
-- suffixes or any other character. Those distinguish genuinely different
-- mailboxes at some providers, and folding them would widen who an allowlist
-- entry approves. Only whitespace — which can never be part of an address a
-- Supabase account is created with — is folded away.
--
-- This migration does not approve anybody. Profiles already created stay
-- exactly as they are; approving an existing account remains a deliberate act
-- via `approve_team_member`.
-- =============================================================================

/* --------------------------------------------- canonical form of an address */

create or replace function public.normalise_email(addr text)
returns text
language sql
immutable
set search_path = public
as $$
  -- Space, tab, newline, carriage return and U+00A0 non-breaking space.
  select lower(translate(coalesce(addr, ''), E' \t\n\r\u00a0', ''));
$$;

revoke all on function public.normalise_email(text) from public, anon, authenticated;
grant execute on function public.normalise_email(text) to service_role;

/* ------------------------------------------ repair any rows already stored */

-- Drop duplicates that only differ by whitespace or case, keeping the oldest,
-- so the normalisation below cannot collide on the primary key.
delete from public.allowed_team_emails a
using public.allowed_team_emails b
where public.normalise_email(a.email) = public.normalise_email(b.email)
  and (a.created_at, a.email) > (b.created_at, b.email);

update public.allowed_team_emails
set email = public.normalise_email(email)
where email <> public.normalise_email(email);

/* ------------------------------------------------- refuse malformed entries */

alter table public.allowed_team_emails
  drop constraint if exists allowed_team_emails_email_check;

do $$ begin
  alter table public.allowed_team_emails
    add constraint allowed_team_emails_canonical
    -- The normalisation is inlined rather than calling normalise_email(), so
    -- the constraint carries no dependency on a function that a dump/restore
    -- might not have created yet.
    check (
      email = lower(translate(email, E' \t\n\r\u00a0', ''))
      and position('@' in email) > 1
      and position('@' in email) < length(email)
    );
exception when duplicate_object then null;
end $$;

/* ------------------------------------------------------ matching at signup */

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_allowed boolean;
begin
  select exists (
    select 1 from public.allowed_team_emails a
    where a.email = public.normalise_email(new.email)
  ) into is_allowed;

  insert into public.profiles (user_id, full_name, email, approved, approved_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    is_allowed,
    case when is_allowed then now() else null end
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/* -------------------------------------------------- approve / revoke by hand */

create or replace function public.approve_team_member(target_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  canonical text := public.normalise_email(target_email);
begin
  if position('@' in canonical) < 2 then
    raise exception 'not an email address';
  end if;

  insert into public.allowed_team_emails (email, note)
  values (canonical, 'added by approve_team_member')
  on conflict (email) do nothing;

  update public.profiles
  set approved = true,
      approved_at = coalesce(approved_at, now())
  where public.normalise_email(email) = canonical;
end;
$$;

revoke all on function public.approve_team_member(text) from public, anon, authenticated;
grant execute on function public.approve_team_member(text) to service_role;

create or replace function public.revoke_team_member(target_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  canonical text := public.normalise_email(target_email);
begin
  delete from public.allowed_team_emails where email = canonical;
  update public.profiles
  set approved = false, approved_at = null
  where public.normalise_email(email) = canonical;
end;
$$;

revoke all on function public.revoke_team_member(text) from public, anon, authenticated;
grant execute on function public.revoke_team_member(text) to service_role;
