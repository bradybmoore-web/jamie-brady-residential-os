import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createTestDatabase, type TestDatabase } from "./harness";

/**
 * `supabase/setup/03-negative-tests.sql` is the script a human pastes into the
 * Supabase SQL editor to prove the authorization rules hold on the real
 * project. It is the last line of defence before the application is pointed at
 * a production database, so it is itself executed here, against real
 * PostgreSQL, with the same shape of data it will meet in production.
 *
 * What this guards against is a script that reports PASS for the wrong reason.
 */
describe("the production negative-test script", () => {
  const SCRIPT = readFileSync("supabase/setup/03-negative-tests.sql", "utf8");
  let db: TestDatabase;
  let rows: { result: string; check_name: string; detail: string }[];

  beforeAll(async () => {
    db = await createTestDatabase();
    // Mirror production: two allowlisted identities approved, one throwaway
    // account that was never allowlisted.
    await db.asServiceRole(
      "insert into public.allowed_team_emails (email, note) values ($1,'Jamie'), ($2,'Brady')",
      ["jamie.moore@example.test", "brady.moore@example.test"],
    );
    await db.signUp("jamie.moore@example.test");
    await db.signUp("brady.moore@example.test");
    await db.signUp("test-unapproved@example.invalid");

    await db.raw.exec(SCRIPT);
    const r = await db.raw.query<{ result: string; check_name: string; detail: string }>(
      "select result, check_name, detail from _security_check order by seq",
    );
    rows = r.rows;
  }, 180_000);

  afterAll(async () => {
    await db.close();
  });

  it("runs to completion and reports every check", () => {
    expect(rows.length).toBeGreaterThanOrEqual(18);
  });

  it("reports no failure, and nothing it could not trust", () => {
    const bad = rows.filter((r) => r.result !== "PASS" && r.result !== "INFO");
    expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
  });

  it("establishes that an approved account CAN read, so 'reads nothing' means something", () => {
    const gate = rows.find((r) => r.check_name === "Approved account CAN read business data");
    expect(gate?.result).toBe("PASS");
    expect(gate?.detail).toContain("Canary visible");
  });

  it("covers every property we claim to enforce", () => {
    const names = rows.map((r) => r.check_name);
    for (const required of [
      "Anonymous visitor reads no business data",
      "Anonymous visitor cannot write business data",
      "Unapproved account reads no business data",
      "Unapproved account cannot see the team roster",
      "Unapproved account cannot read the allowlist",
      "Unapproved account cannot write business data",
      "Unapproved account cannot delete business data",
      "Account cannot approve itself",
      "Account cannot add itself to the allowlist",
      "Account cannot call the approval function",
      "Even an approved account cannot change approval",
      "Credential columns are unreadable by signed-in users",
      "Row level security is enabled on every public table",
      "Outbound actions are forced through approval at the database level",
    ]) {
      expect(names, `missing check: ${required}`).toContain(required);
    }
  });

  it("leaves the canary row behind in no circumstances", async () => {
    const left = await db.asServiceRole(
      "select count(*)::int as n from public.contacts_cache where last_name like 'CANARY%'",
    );
    expect(left.rows[0]).toMatchObject({ n: 0 });
  });

  it("refuses to report PASS when the database is empty of business data", async () => {
    // The vacuity guard: with grants revoked the approved account cannot see
    // the canary, and the "reads nothing" rows must downgrade to INVALID
    // rather than claiming success.
    const probe = await createTestDatabase();
    await probe.asServiceRole("insert into public.allowed_team_emails (email) values ($1)", [
      "jamie.moore@example.test",
    ]);
    await probe.signUp("jamie.moore@example.test");
    await probe.signUp("test-unapproved@example.invalid");
    await probe.raw.exec("revoke select on public.contacts_cache from authenticated");
    await probe.raw.exec(SCRIPT);
    const r = await probe.raw.query<{ result: string; check_name: string }>(
      "select result, check_name from _security_check order by seq",
    );
    const gate = r.rows.find((x) => x.check_name === "Approved account CAN read business data");
    expect(gate?.result).toBe("FAIL");
    const anon = r.rows.find((x) => x.check_name === "Anonymous visitor reads no business data");
    expect(anon?.result, "a vacuous read must not be reported as PASS").not.toBe("PASS");
    await probe.close();
  }, 180_000);
});
