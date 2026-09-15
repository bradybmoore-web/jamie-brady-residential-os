-- =============================================================================
-- Step 2 — decide who is allowed in.
--
-- Run this BEFORE creating anybody in Authentication -> Users. When an account
-- is created, a trigger checks this list: if the address is here the profile is
-- approved automatically, and if it is not, the account is created but can read
-- nothing at all.
--
-- Replace the two placeholder addresses below with the real ones, then run.
-- Addresses live here, in your database — never in the application's source
-- code, which is why this file ships with placeholders.
-- =============================================================================

insert into public.allowed_team_emails (email, note)
values
  (lower('REPLACE_WITH_JAMIES_EMAIL'), 'Jamie Moore'),
  (lower('REPLACE_WITH_BRADYS_EMAIL'), 'Brady Moore')
on conflict (email) do update set note = excluded.note;

-- Confirm exactly the two intended addresses are listed, and nothing else.
select email, note, created_at
from public.allowed_team_emails
order by email;
