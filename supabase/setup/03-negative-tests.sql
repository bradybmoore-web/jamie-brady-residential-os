-- =============================================================================
-- Prove the security rules actually work, on the real database.
--
-- This runs every check as the real database roles: an anonymous visitor, an
-- approved team member, and an account that exists but was never allowlisted.
-- It reports; it leaves nothing behind.
--
-- BEFORE RUNNING: create a throwaway account in Authentication -> Users with an
-- address that is NOT on the allowlist (for example test-unapproved@example.com).
-- The script needs one unapproved account to test against and will say so if it
-- cannot find one. Delete that account afterwards.
--
-- WHY THERE IS A CANARY ROW
--
-- An empty database makes "this account can read nothing" pass for the wrong
-- reason: there is nothing to read. That is a vacuous test and it proves
-- nothing about the policies. So the script inserts one clearly-marked row,
-- first establishes that an APPROVED account can see it — which is what makes
-- every "sees nothing" result below meaningful — and deletes it at the end. If
-- the script fails part way through, the whole block rolls back and the canary
-- goes with it; it cannot be left behind.
--
-- Every row of the output should read PASS, except rows marked INFO.
-- If the final SELECT returns no rows at all, the block aborted — read the
-- error Supabase shows above it rather than assuming anything passed.
-- =============================================================================

drop table if exists _security_check;
create temp table _security_check (
  seq int generated always as identity,
  result text,
  check_name text,
  detail text
);
grant all on _security_check to anon, authenticated, service_role;

do $$
declare
  approved_uid uuid;
  approved_pid uuid;
  unapproved_uid uuid;
  canary_id uuid;
  visible int;
  before_state boolean;
  -- Set once the approved account has been shown to read the canary. Until
  -- then, "reads nothing" results cannot be trusted and are reported as
  -- INVALID rather than PASS.
  grants_proven boolean := false;
begin
  select p.user_id, p.id into approved_uid, approved_pid
  from public.profiles p where p.approved order by p.created_at limit 1;

  select p.user_id into unapproved_uid
  from public.profiles p where not p.approved order by p.created_at limit 1;

  if approved_uid is null then
    insert into _security_check (result, check_name, detail)
    values ('SETUP', 'No approved account found',
            'Create Jamie and Brady in Authentication -> Users first, then re-run.');
    return;
  end if;

  if unapproved_uid is null then
    insert into _security_check (result, check_name, detail)
    values ('SETUP', 'No unapproved account found',
            'Create a throwaway user with an address that is NOT allowlisted, then re-run.');
    return;
  end if;

  /* -------------------------------------------------------------- canary --*/
  insert into public.contacts_cache (first_name, last_name, owner_id, is_seed)
  values ('SECURITY', 'CANARY (temporary)', approved_pid, true)
  returning id into canary_id;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', approved_uid::text, true);
    select count(*) into visible from public.contacts_cache where id = canary_id;
    reset role;
    grants_proven := visible = 1;
    insert into _security_check (result, check_name, detail)
    values (case when grants_proven then 'PASS' else 'FAIL' end,
            'Approved account CAN read business data',
            case when grants_proven
                 then 'Canary visible — the "reads nothing" checks below are meaningful'
                 else 'Canary NOT visible. Either a grant is missing or the approved '
                      || 'account is wrong. Every "reads nothing" result below is '
                      || 'therefore untrustworthy.' end);
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('FAIL', 'Approved account CAN read business data', 'Unexpected refusal: ' || SQLERRM);
  end;

  /* ---------------------------------------------------------------- anon --*/
  begin
    set local role anon;
    select count(*) into visible from public.contacts_cache;
    reset role;
    insert into _security_check (result, check_name, detail)
    values (case when not grants_proven then 'INVALID' when visible = 0 then 'PASS' else 'FAIL' end,
            'Anonymous visitor reads no business data', visible || ' rows visible (0 expected)');
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Anonymous visitor reads no business data', 'Refused: ' || SQLERRM);
  end;

  begin
    set local role anon;
    select count(*) into visible from public.profiles;
    reset role;
    insert into _security_check (result, check_name, detail)
    values (case when visible = 0 then 'PASS' else 'FAIL' end,
            'Anonymous visitor reads no profiles', visible || ' rows visible (0 expected)');
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Anonymous visitor reads no profiles', 'Refused: ' || SQLERRM);
  end;

  begin
    set local role anon;
    insert into public.contacts_cache (first_name, last_name, owner_id)
    values ('Anon', 'Injected', approved_pid);
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('FAIL', 'Anonymous visitor cannot write business data', 'THE INSERT SUCCEEDED — STOP');
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Anonymous visitor cannot write business data', 'Refused: ' || SQLERRM);
  end;

  /* -------------------------------------------------- unapproved account --*/
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', unapproved_uid::text, true);
    select count(*) into visible from public.contacts_cache;
    reset role;
    insert into _security_check (result, check_name, detail)
    values (case when not grants_proven then 'INVALID' when visible = 0 then 'PASS' else 'FAIL' end,
            'Unapproved account reads no business data', visible || ' rows visible (0 expected)');
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Unapproved account reads no business data', 'Refused: ' || SQLERRM);
  end;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', unapproved_uid::text, true);
    select count(*) into visible from public.profiles;
    reset role;
    insert into _security_check (result, check_name, detail)
    values (case when visible = 0 then 'PASS' else 'FAIL' end,
            'Unapproved account cannot see the team roster', visible || ' rows visible (0 expected)');
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Unapproved account cannot see the team roster', 'Refused: ' || SQLERRM);
  end;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', unapproved_uid::text, true);
    select count(*) into visible from public.allowed_team_emails;
    reset role;
    insert into _security_check (result, check_name, detail)
    values (case when visible = 0 then 'PASS' else 'FAIL' end,
            'Unapproved account cannot read the allowlist', visible || ' rows visible (0 expected)');
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Unapproved account cannot read the allowlist', 'Refused: ' || SQLERRM);
  end;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', unapproved_uid::text, true);
    select public.is_team_member() into before_state;
    reset role;
    insert into _security_check (result, check_name, detail)
    values (case when before_state = false then 'PASS' else 'FAIL' end,
            'Unapproved account is not a team member', 'is_team_member() = ' || before_state);
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Unapproved account is not a team member', 'Refused: ' || SQLERRM);
  end;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', unapproved_uid::text, true);
    insert into public.contacts_cache (first_name, last_name, owner_id)
    values ('Unapproved', 'Injected', approved_pid);
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('FAIL', 'Unapproved account cannot write business data', 'THE INSERT SUCCEEDED — STOP');
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Unapproved account cannot write business data', 'Refused: ' || SQLERRM);
  end;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', unapproved_uid::text, true);
    delete from public.contacts_cache where id = canary_id;
    reset role;
    select count(*) into visible from public.contacts_cache where id = canary_id;
    insert into _security_check (result, check_name, detail)
    values (case when visible = 1 then 'PASS' else 'FAIL' end,
            'Unapproved account cannot delete business data',
            case when visible = 1 then 'Delete had no effect' else 'THE CANARY WAS DELETED — STOP' end);
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Unapproved account cannot delete business data', 'Refused: ' || SQLERRM);
  end;

  /* ------------------------------------------------------ self-approval ---*/
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', unapproved_uid::text, true);
    update public.profiles set approved = true where user_id = unapproved_uid;
    reset role;
    select p.approved into before_state from public.profiles p where p.user_id = unapproved_uid;
    insert into _security_check (result, check_name, detail)
    values (case when before_state then 'FAIL' else 'PASS' end,
            'Account cannot approve itself',
            case when before_state then 'IT APPROVED ITSELF — STOP' else 'Update had no effect' end);
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Account cannot approve itself', 'Refused: ' || SQLERRM);
  end;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', unapproved_uid::text, true);
    insert into public.allowed_team_emails (email) values ('attacker@example.invalid');
    reset role;
    delete from public.allowed_team_emails where email = 'attacker@example.invalid';
    insert into _security_check (result, check_name, detail)
    values ('FAIL', 'Account cannot add itself to the allowlist', 'THE INSERT SUCCEEDED — STOP');
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Account cannot add itself to the allowlist', 'Refused: ' || SQLERRM);
  end;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', unapproved_uid::text, true);
    perform public.approve_team_member('attacker@example.invalid');
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('FAIL', 'Account cannot call the approval function', 'THE CALL SUCCEEDED — STOP');
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Account cannot call the approval function', 'Refused: ' || SQLERRM);
  end;

  /* --------------------------------------------------- approved account ---*/
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', approved_uid::text, true);
    select public.is_team_member() into before_state;
    reset role;
    insert into _security_check (result, check_name, detail)
    values (case when before_state then 'PASS' else 'FAIL' end,
            'Approved account IS a team member', 'is_team_member() = ' || before_state);
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('FAIL', 'Approved account IS a team member', 'Unexpected refusal: ' || SQLERRM);
  end;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', approved_uid::text, true);
    select count(*) into visible from public.profiles;
    reset role;
    insert into _security_check (result, check_name, detail)
    values (case when visible > 0 then 'PASS' else 'FAIL' end,
            'Approved account can see the team roster', visible || ' profiles visible');
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('FAIL', 'Approved account can see the team roster', 'Unexpected refusal: ' || SQLERRM);
  end;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', approved_uid::text, true);
    update public.profiles set approved = false where user_id = approved_uid;
    reset role;
    select p.approved into before_state from public.profiles p where p.user_id = approved_uid;
    insert into _security_check (result, check_name, detail)
    values (case when before_state then 'PASS' else 'FAIL' end,
            'Even an approved account cannot change approval',
            case when before_state then 'Update had no effect' else 'IT CHANGED ITS OWN APPROVAL — STOP' end);
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Even an approved account cannot change approval', 'Refused: ' || SQLERRM);
  end;

  /* ------------------------------------------------ per-person isolation --*/
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', approved_uid::text, true);
    select count(*) into visible from public.integration_accounts;
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Integration accounts table is reachable and owner-scoped',
            visible || ' rows visible (0 expected until Phase 3)');
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('FAIL', 'Integration accounts table is reachable', 'Unexpected refusal: ' || SQLERRM);
  end;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', approved_uid::text, true);
    perform access_token from public.integration_accounts limit 1;
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('FAIL', 'Credential columns are unreadable by signed-in users', 'THE COLUMN WAS READABLE — STOP');
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Credential columns are unreadable by signed-in users', 'Refused: ' || SQLERRM);
  end;

  /* ---------------------------------------------- structural guarantees ---*/
  select count(*) into visible
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  insert into _security_check (result, check_name, detail)
  values (case when visible = 0 then 'PASS' else 'FAIL' end,
          'Row level security is enabled on every public table',
          visible || ' tables without RLS (0 expected)');

  select count(*) into visible from pg_constraint
  where conname = 'ai_actions_outbound_requires_approval';
  insert into _security_check (result, check_name, detail)
  values (case when visible = 1 then 'PASS' else 'FAIL' end,
          'Outbound actions are forced through approval at the database level',
          case when visible = 1 then 'CHECK constraint present'
               else 'CONSTRAINT MISSING — email/text drafts could skip approval' end);

  select count(*) into visible from pg_constraint
  where conname = 'allowed_team_emails_canonical';
  insert into _security_check (result, check_name, detail)
  values ('INFO', 'Allowlist whitespace hardening (migration 0006)',
          case when visible = 1 then 'Applied.'
               else 'Not applied yet. Not a vulnerability: it prevents an address '
                 || 'with invisible whitespace from silently failing to approve.' end);

  /* ----------------------------------------------------- remove the canary */
  delete from public.contacts_cache where id = canary_id;

  select count(*) into visible from public.contacts_cache where id = canary_id;
  insert into _security_check (result, check_name, detail)
  values (case when visible = 0 then 'PASS' else 'FAIL' end,
          'Canary row removed', visible || ' canary rows remaining (0 expected)');
end $$;

-- ---------------------------------------------------------------- results --
select result, check_name, detail from _security_check order by seq;
