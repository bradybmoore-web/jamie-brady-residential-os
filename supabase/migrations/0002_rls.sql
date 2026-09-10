-- Row level security.
--
-- Model: this is a two-person brokerage team. Both agents are trusted with the
-- whole book of business, so the rule is "any authenticated team member with a
-- profile can read and write", not per-record ownership walls. That is a
-- deliberate simplification — the brief explicitly says not to build
-- complicated permissions. Ownership is still recorded on every row via
-- owner_id/assigned_to so tighter policies can be layered on later without a
-- schema change.
--
-- The service role key bypasses RLS and is only ever used server-side.

create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p where p.user_id = auth.uid()
  );
$$;

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.profiles p where p.user_id = auth.uid() limit 1;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'contacts_cache','contact_notes','stated_plans','leads','properties','listings',
    'showing_feedback','seller_updates','buyers','transactions','tasks','calendar_events_cache',
    'email_events_cache','opportunities','ai_runs','ai_actions','listing_marketing',
    'marketing_assets','daily_briefs','appointment_preps','integration_connections'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_team_member())',
      t || '_select', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_team_member())',
      t || '_insert', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_team_member()) with check (public.is_team_member())',
      t || '_update', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_team_member())',
      t || '_delete', t
    );
  end loop;
end;
$$;

-- Profiles: you may read the team, but only edit yourself.
alter table public.profiles enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (public.is_team_member());

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Audit log: append-only from the application's point of view. No update or
-- delete policy exists, so those operations are denied for every authenticated
-- role regardless of what the application asks for.
alter table public.audit_log enable row level security;

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.is_team_member());

create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (public.is_team_member());

-- New auth users get a profile automatically so RLS lets them in on first load.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
