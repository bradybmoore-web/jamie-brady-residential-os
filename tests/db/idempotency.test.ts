import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./harness";

/**
 * The setup file must survive being run more than once.
 *
 * It is applied by hand, by pasting it into the Supabase SQL editor. The person
 * doing that is not a developer: re-pasting, double-clicking Run, or re-running
 * after an unrelated error are all likely. Before this was enforced, a second
 * run failed with `type "source_system" already exists` — an alarming message
 * that gives no hint whether the database is now half-broken.
 */

let db: TestDatabase;

const SETUP_FILE = "supabase/setup/all-migrations.sql";

/** PGlite lacks pgcrypto; gen_random_uuid() is native from PostgreSQL 13. */
function portable(sql: string) {
  return sql.replace(/create extension if not exists "pgcrypto";/, "-- pgcrypto is native in PG13+");
}

beforeAll(async () => {
  // createTestDatabase already applies every migration once.
  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("the single-paste setup file", () => {
  it("is generated from every migration, in order", () => {
    const setup = readFileSync(SETUP_FILE, "utf8");
    for (const file of ["0001_init.sql", "0002_rls.sql", "0003_approved_team_members.sql", "0004_integration_accounts.sql", "0005_profile_provenance.sql"]) {
      expect(setup, `${file} missing from the setup file`).toContain(file);
    }
    // Regenerating it is the only supported way to change it.
    expect(setup).toContain("GENERATED FILE");
  });

  it("applies cleanly a second and third time", async () => {
    const setup = portable(readFileSync(SETUP_FILE, "utf8"));
    for (const attempt of [2, 3]) {
      const result = await db.asServiceRole("select 1 as ok");
      expect(result.error).toBeNull();
      await expect(db.raw.exec(setup), `run ${attempt} failed`).resolves.toBeDefined();
    }
  }, 60_000);

  it("leaves exactly one copy of every policy", async () => {
    const duplicates = await db.asServiceRole(`
      select tablename, policyname, count(*)::int as n
      from pg_policies where schemaname = 'public'
      group by tablename, policyname having count(*) > 1
    `);
    expect(duplicates.rows).toEqual([]);
  });

  it("leaves the schema intact after repeated runs", async () => {
    const tables = await db.asServiceRole(`
      select count(*)::int as n from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `);
    expect(tables.rows[0].n).toBe(25);

    const rlsOff = await db.asServiceRole(`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
    `);
    expect(rlsOff.rows).toEqual([]);
  });

  it("still denies an unapproved account after repeated runs", async () => {
    // Re-running the setup must not reset approval or loosen a policy.
    const outsider = await db.signUp("idempotency-outsider@example.test");
    const member = await db.asUser(outsider.userId, "select public.is_team_member() as m");
    expect(member.rows[0].m).toBe(false);
  });
});

describe("the operator-facing SQL scripts", () => {
  it("ships an allowlist script with placeholders, not real addresses", () => {
    const sql = readFileSync("supabase/setup/02-allowlist.sql", "utf8");
    expect(sql).toContain("REPLACE_WITH_JAMIES_EMAIL");
    expect(sql).toContain("REPLACE_WITH_BRADYS_EMAIL");
    expect(sql).not.toMatch(/@(?!example\.|realdomain)[a-z0-9-]+\.(com|net|org)/i);
  });

  it("runs the allowlist script and approves only those addresses on signup", async () => {
    const sql = readFileSync("supabase/setup/02-allowlist.sql", "utf8")
      .replace("REPLACE_WITH_JAMIES_EMAIL", "allow-a@example.test")
      .replace("REPLACE_WITH_BRADYS_EMAIL", "allow-b@example.test");
    await db.raw.exec(sql);

    const allowed = await db.signUp("allow-a@example.test", "Allowed Person");
    const denied = await db.signUp("not-allowed@example.test", "Other Person");

    expect((await db.asUser(allowed.userId, "select public.is_team_member() as m")).rows[0].m).toBe(true);
    expect((await db.asUser(denied.userId, "select public.is_team_member() as m")).rows[0].m).toBe(false);
  });

  it("runs the negative-test script and every check passes", async () => {
    const sql = readFileSync("supabase/setup/03-negative-tests.sql", "utf8");
    // The trailing SELECT is the editor's result set; run the part that fills
    // the table, then read it back.
    const [body] = sql.split("-- ---------------------------------------------------------------- results --");
    await db.raw.exec(body);

    // Read on the same connection that created the temp table, which is what
    // the SQL editor does when it runs the file's trailing SELECT.
    const results = await db.raw.query<{ result: string; check_name: string; detail: string }>(
      "select result, check_name, detail from _security_check order by seq",
    );
    expect(results.rows.length).toBeGreaterThanOrEqual(10);

    const failures = results.rows.filter((r) => r.result !== "PASS");
    expect(
      failures.map((f) => `${f.check_name}: ${f.detail}`),
      "the operator-facing security script reported a failure",
    ).toEqual([]);
  }, 60_000);
});
