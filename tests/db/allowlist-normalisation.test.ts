import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createTestDatabase, type TestDatabase } from "./harness";

/**
 * Regression tests for the bootstrapping failure that migration 0006 fixes:
 * an allowlist address carrying invisible whitespace satisfied the old check
 * constraint but never matched the account it was meant to approve.
 */
describe("allowlist address normalisation", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  }, 120_000);
  afterAll(async () => {
    await db.close();
  });

  const reset = async () => {
    await db.raw.query("delete from auth.users");
    await db.asServiceRole("delete from public.allowed_team_emails");
  };

  it("refuses to store an address with a trailing space", async () => {
    await reset();
    const r = await db.asServiceRole("insert into public.allowed_team_emails (email) values ($1)", [
      "jamie@example.test ",
    ]);
    expect(r.error).toMatch(/allowed_team_emails_canonical/);
  });

  it("refuses to store an address with a non-breaking space", async () => {
    await reset();
    const r = await db.asServiceRole("insert into public.allowed_team_emails (email) values ($1)", [
      "jamie@example.test ",
    ]);
    expect(r.error).toMatch(/allowed_team_emails_canonical/);
  });

  it("refuses to store an uppercase address", async () => {
    await reset();
    const r = await db.asServiceRole("insert into public.allowed_team_emails (email) values ($1)", [
      "Jamie@example.test",
    ]);
    expect(r.error).toMatch(/allowed_team_emails_canonical/);
  });

  it("refuses to store something that is not an address", async () => {
    await reset();
    for (const bad of ["jamie", "@example.test", "jamie@"]) {
      const r = await db.asServiceRole("insert into public.allowed_team_emails (email) values ($1)", [bad]);
      expect(r.error, `expected ${bad} to be refused`).toMatch(/allowed_team_emails_canonical/);
    }
  });

  it("approves a signup whose address carries stray whitespace", async () => {
    await reset();
    await db.asServiceRole("insert into public.allowed_team_emails (email) values ('jamie@example.test')");
    const { userId } = await db.signUp("  Jamie@Example.test  ");
    const r = await db.asServiceRole("select approved from public.profiles where user_id = $1", [userId]);
    expect(r.rows[0]).toMatchObject({ approved: true });
  });

  it("still refuses an address that is genuinely different", async () => {
    await reset();
    await db.asServiceRole("insert into public.allowed_team_emails (email) values ('jamie@example.test')");
    for (const other of ["jamie@other.test", "jamie.moore@example.test", "jamie+os@example.test"]) {
      await db.raw.query("delete from auth.users");
      const { userId } = await db.signUp(other);
      const r = await db.asServiceRole("select approved from public.profiles where user_id = $1", [userId]);
      expect(r.rows[0], `${other} must not be approved by jamie@example.test`).toMatchObject({ approved: false });
    }
  });

  it("approve_team_member normalises the address it is given", async () => {
    await reset();
    const { userId } = await db.signUp("jamie@example.test");
    await db.asServiceRole("select public.approve_team_member($1)", ["  JAMIE@Example.test "]);
    const p = await db.asServiceRole("select approved from public.profiles where user_id = $1", [userId]);
    expect(p.rows[0]).toMatchObject({ approved: true });
    const a = await db.asServiceRole("select email from public.allowed_team_emails");
    expect(a.rows).toEqual([{ email: "jamie@example.test" }]);
  });

  it("revoke_team_member normalises the address it is given", async () => {
    await reset();
    await db.asServiceRole("insert into public.allowed_team_emails (email) values ('jamie@example.test')");
    const { userId } = await db.signUp("jamie@example.test");
    await db.asServiceRole("select public.revoke_team_member($1)", ["Jamie@Example.test "]);
    const p = await db.asServiceRole("select approved from public.profiles where user_id = $1", [userId]);
    expect(p.rows[0]).toMatchObject({ approved: false });
    expect((await db.asServiceRole("select email from public.allowed_team_emails")).rows).toEqual([]);
  });

  it("a signed-in user cannot call normalise_email to probe the allowlist", async () => {
    await reset();
    await db.asServiceRole("insert into public.allowed_team_emails (email) values ('jamie@example.test')");
    const { userId } = await db.signUp("jamie@example.test");
    const r = await db.asUser(userId, "select public.normalise_email('x@y.test')");
    expect(r.error).toMatch(/permission denied/i);
  });

  it("does not retro-approve an account that already exists", async () => {
    // The migration repairs the allowlist; it must never grant access to a
    // profile that was created unapproved. Approval stays a deliberate act.
    await reset();
    const { userId } = await db.signUp("stranger@example.test");
    await db.asServiceRole("insert into public.allowed_team_emails (email) values ('stranger@example.test')");
    const r = await db.asServiceRole("select approved from public.profiles where user_id = $1", [userId]);
    expect(r.rows[0]).toMatchObject({ approved: false });
  });
});

describe("the migration source itself", () => {
  // The normalisation removes U+00A0. Writing that character *literally* into
  // the SQL would make the rule invisible in an editor and liable to be lost
  // to a copy/paste — the very failure this migration exists to prevent. It is
  // written as an escape, and stays that way.
  const files = [
    "supabase/migrations/0006_allowlist_normalisation.sql",
    "supabase/setup/diagnose-approval.sql",
    "supabase/setup/all-migrations.sql",
  ];

  it.each(files)("%s contains no invisible characters", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toContain(" ");
    expect(source).toContain("\\u00a0");
    // No character that renders as nothing, or as an ordinary space while not
    // being one: non-breaking and narrow spaces, zero-width marks, a byte order
    // mark, and control characters other than tab and newline.
    const invisible = /[\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]|[\u0000-\u0008\u000b-\u001f\u007f]/gu;
    const stray = [...source.matchAll(invisible)].map((m) => "U+" + m[0].codePointAt(0)!.toString(16).padStart(4, "0"));
    expect(stray).toEqual([]);
  });
});
