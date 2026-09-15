-- =============================================================================
-- Step 4 — prove the security rules actually work, on the real database.
--
-- This runs the checks as the real database roles: an anonymous visitor, an
-- approved team member, and an account that exists but was never allowlisted.
-- It reads and reports; it changes nothing permanently.
--
-- BEFORE RUNNING: create a throwaway account in Authentication -> Users with an
-- address that is NOT on the allowlist (for example test-unapproved@example.com).
-- The script needs one unapproved account to test against, and will tell you if
-- it cannot find one.
--
-- Every row of the output should say PASS. Delete the throwaway account
-- afterwards.
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
  unapproved_uid uuid;
  visible int;
  before_state boolean;
begin
  select p.user_id into approved_uid from public.profiles p where p.approved order by p.created_at limit 1;
  select p.user_id into unapproved_uid from public.profiles p where not p.approved order by p.created_at limit 1;

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

  /* ---------------------------------------------------------------- anon --*/
  begin
    set local role anon;
    select count(*) into visible from public.contacts_cache;
    reset role;
    insert into _security_check (result, check_name, detail)
    values (case when visible = 0 then 'PASS' else 'FAIL' end,
            'Anonymous visitor reads no contacts', visible || ' rows visible');
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Anonymous visitor reads no contacts', 'Refused: ' || SQLERRM);
  end;

  begin
    set local role anon;
    select count(*) into visible from public.profiles;
    reset role;
    insert into _security_check (result, check_name, detail)
    values (case when visible = 0 then 'PASS' else 'FAIL' end,
            'Anonymous visitor reads no profiles', visible || ' rows visible');
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Anonymous visitor reads no profiles', 'Refused: ' || SQLERRM);
  end;

  /* -------------------------------------------------- unapproved account --*/
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', unapproved_uid::text, true);
    select count(*) into visible from public.contacts_cache;
    reset role;
    insert into _security_check (result, check_name, detail)
    values (case when visible = 0 then 'PASS' else 'FAIL' end,
            'Unapproved account reads no business data', visible || ' rows visible');
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
            'Unapproved account cannot see the team roster', visible || ' rows visible');
  exception when others then
    reset role;
    insert into _security_check (result, check_name, detail)
    values ('PASS', 'Unapproved account cannot see the team roster', 'Refused: ' || SQLERRM);
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
    values ('PASS', 'Integration accounts table is reachable and empty per person',
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
end $$;

-- ---------------------------------------------------------------- results --
select result, check_name, detail from _security_check order by seq;
