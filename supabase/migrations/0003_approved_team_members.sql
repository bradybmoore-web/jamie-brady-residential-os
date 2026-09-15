-- Explicit authorization.
--
-- Migration 0002 granted access to anyone holding a row in `profiles`, and
-- `handle_new_user` created that row for every new auth user. Supabase projects
-- allow public email signup by default, so the combination meant that anyone
-- who could reach the signup endpoint could read the entire book of business.
--
-- This migration makes authorization explicit and deny-by-default:
--
--   * `profiles.approved` defaults to FALSE. An unapproved profile sees nothing.
--   * `allowed_team_emails` is an allowlist. Signing up with an address on it
--     approves the profile automatically; signing up with any other address
--     creates an unapproved profile that cannot read a single row.
--   * A signed-in user cannot approve themselves. Column-level grants prevent
--     `approved` from being written by the `authenticated` role at all, and the
--     row policies refuse it a second time.
--
-- Bootstrapping is a deliberate, manual act performed with the service role or
-- the SQL editor. See README -> "Authorizing team members".

/* ------------------------------------------------------------- allowlist */

create table if not exists public.allowed_team_emails (
  -- Always stored lowercase; the trigger and the constraint both fold case.
  email text primary key check (email = lower(email)),
  note text,
  created_at timestamptz not null default now()
);

alter table public.allowed_team_emails enable row level security;

-- Approved members may see who else is permitted. Nobody using the anon or
-- authenticated role may modify it: there is no insert, update or delete
-- policy, so those operations are denied regardless of grants. Changing the
-- allowlist requires the service role or direct SQL access.
drop policy if exists allowed_team_emails_select on public.allowed_team_emails;
create policy allowed_team_emails_select on public.allowed_team_emails
  for select to authenticated
  using (public.is_team_member());

/* ----------------------------------------------------- profiles.approved */

alter table public.profiles
  add column if not exists approved boolean not null default false,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null;

create index if not exists profiles_approved_idx on public.profiles (approved) where approved;

/* -------------------------------------------------- deny-by-default gate */

-- Redefining this function re-secures every policy written in 0002, since they
-- all call it. Access now requires an approved profile, not merely any profile.
create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.approved
  );
$$;

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.user_id = auth.uid()
    and p.approved
  limit 1;
$$;

/* ------------------------------------------- signup cannot self-authorize */

-- Column-level privileges: the `authenticated` role may never write `approved`,
-- `approved_at`, `approved_by`, `user_id` or `email`. Supabase grants ALL on
-- public tables to `authenticated` by default, so these have to be revoked
-- before the narrower grants are issued.
revoke insert, update on public.profiles from authenticated;
grant insert (user_id, full_name, email) on public.profiles to authenticated;
grant update (full_name, title, phone, license_number) on public.profiles to authenticated;

-- Belt and braces: even if a future grant were widened by mistake, the row
-- policy still refuses a self-inserted profile that claims to be approved.
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid() and approved = false);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A new auth user is approved only if their address is on the allowlist.
-- Everyone else gets an unapproved profile: it records that they signed up,
-- and it grants them nothing.
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
    where a.email = lower(new.email)
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

/* --------------------------------------------------------------- helpers */

-- Approve someone already signed up. Intended for the SQL editor or the
-- service role. It is NOT granted to `authenticated`, so a signed-in user
-- cannot call it to approve themselves.
create or replace function public.approve_team_member(target_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.allowed_team_emails (email, note)
  values (lower(target_email), 'added by approve_team_member')
  on conflict (email) do nothing;

  update public.profiles
  set approved = true,
      approved_at = coalesce(approved_at, now())
  where lower(email) = lower(target_email);
end;
$$;

revoke all on function public.approve_team_member(text) from public, anon, authenticated;

-- Revoke access for someone who should no longer see client data.
create or replace function public.revoke_team_member(target_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.allowed_team_emails where email = lower(target_email);
  update public.profiles
  set approved = false, approved_at = null
  where lower(email) = lower(target_email);
end;
$$;

revoke all on function public.revoke_team_member(text) from public, anon, authenticated;
