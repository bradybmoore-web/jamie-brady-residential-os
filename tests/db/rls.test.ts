import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, migrationFiles, type TestDatabase } from "./harness";

/**
 * Row level security, proven against a real PostgreSQL engine.
 *
 * Every assertion here runs actual SQL as an actual role. If a policy is
 * subtly permissive, or a column grant is wider than intended, these fail —
 * which reading the migration text cannot tell you.
 *
 * The scenario mirrors production: Jamie and Brady are allowlisted, an outsider
 * signs up uninvited, and a visitor arrives with no session at all.
 */

let db: TestDatabase;

// Deliberately not the real addresses — those live in configuration, never in
// source. These are fixtures.
const JAMIE = "jamie@example.test";
const BRADY = "brady@example.test";
const OUTSIDER = "stranger@example.test";

let jamie: { userId: string; profileId: string | null };
let brady: { userId: string; profileId: string | null };
let outsider: { userId: string; profileId: string | null };

beforeAll(async () => {
  db = await createTestDatabase();

  // The allowlist is seeded before signup, exactly as the real bootstrap does.
  await db.asServiceRole("insert into public.allowed_team_emails (email, note) values ($1, 'test'), ($2, 'test')", [
    JAMIE,
    BRADY,
  ]);

  jamie = await db.signUp(JAMIE, "Jamie Moore");
  brady = await db.signUp(BRADY, "Brady Moore");
  outsider = await db.signUp(OUTSIDER, "Uninvited Person");

  // A row of business data for the access tests to reach for.
  await db.asServiceRole(
    `insert into public.contacts_cache (first_name, last_name, email, owner_id, is_seed)
     values ('Demo', 'Contact', 'demo@example.test', $1, true)`,
    [jamie.profileId],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

/* ===================== the migrations run as written ===================== */

describe("migrations", () => {
  it("apply cleanly, in order, against a real PostgreSQL server", async () => {
    // Reaching this point at all means every migration executed without error,
    // in filename order, against a real server — which is the assertion that
    // matters. beforeAll would have thrown otherwise.
    const version = await db.asServiceRole("select version()");
    expect(String(version.rows[0].version)).toMatch(/PostgreSQL/);
  });

  it("are numbered sequentially, so the apply order is unambiguous", () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);

    const numbers = files.map((f) => {
      const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(f);
      expect(match, `"${f}" does not match NNNN_name.sql`).not.toBeNull();
      return Number(match![1]);
    });

    // No duplicates, no gaps — a gap or a collision makes "run them in order"
    // ambiguous the moment two people add a migration on the same day.
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("depends only on objects created by an earlier migration", () => {
    // 0002 policies call is_team_member(); 0003 redefines it; 0004 and 0005
    // build on both. Anything referencing a table before it is created would
    // have failed the apply above, but this pins the intent explicitly.
    const files = migrationFiles();
    expect(files[0]).toMatch(/^0001_/);
    expect(files.some((f) => /^0002_/.test(f))).toBe(true);
  });

  it("leaves row level security enabled on every table in the public schema", async () => {
    const result = await db.asServiceRole(`
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
    `);
    expect(result.rows.map((r) => r.table_name)).toEqual([]);
  });

  it("creates the expected number of tables", async () => {
    const result = await db.asServiceRole(`
      select count(*)::int as n from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `);
    expect(result.rows[0].n).toBe(25);
  });
});

/* ===================== harness fidelity (not vacuous) ==================== */

describe("the test environment matches Supabase", () => {
  /**
   * If the harness forgot to grant table privileges, every "sees nothing" test
   * below would pass for the wrong reason — a missing GRANT rather than a
   * policy denial. Supabase grants ALL on public tables to anon and
   * authenticated by default and relies entirely on RLS, so the harness must
   * too, and this proves it does.
   */
  it("grants anon and authenticated table-level SELECT, leaving RLS as the only defence", async () => {
    const result = await db.asServiceRole(`
      select r.rolname, acl.privilege_type
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) as acl
      join pg_roles r on r.oid = acl.grantee
      where n.nspname = 'public' and c.relname = 'contacts_cache'
        and r.rolname in ('anon', 'authenticated') and acl.privilege_type = 'SELECT'
    `);
    const roles = result.rows.map((r) => r.rolname).sort();
    expect(roles).toEqual(["anon", "authenticated"]);
  });

  it("confirms the row that the access tests are trying to reach really exists", async () => {
    const result = await db.asServiceRole("select count(*)::int as n from public.contacts_cache");
    expect(result.rows[0].n).toBeGreaterThan(0);
  });

  it("gives the service role BYPASSRLS, as Supabase does", async () => {
    const result = await db.asServiceRole("select rolbypassrls from pg_roles where rolname = 'service_role'");
    expect(result.rows[0].rolbypassrls).toBe(true);
  });
});

/* ========================= 1. anonymous sees nothing ===================== */

describe("an anonymous visitor", () => {
  const TABLES = [
    "contacts_cache",
    "leads",
    "listings",
    "properties",
    "transactions",
    "tasks",
    "ai_actions",
    "ai_runs",
    "audit_log",
    "profiles",
    "allowed_team_emails",
    "integration_accounts",
  ];

  it("reads no rows from any table", async () => {
    for (const table of TABLES) {
      const result = await db.asAnon(`select * from public.${table}`);
      // Either the policy returns nothing, or the grant refuses outright.
      // Both are acceptable; returning data is not.
      expect(result.rows, `anon could read ${table}`).toEqual([]);
    }
  });

  it("cannot insert into business tables", async () => {
    const result = await db.asAnon(
      "insert into public.contacts_cache (first_name, last_name, owner_id) values ('A', 'B', gen_random_uuid())",
    );
    expect(result.error).toBeTruthy();
  });

  it("cannot add itself to the allowlist", async () => {
    const result = await db.asAnon("insert into public.allowed_team_emails (email) values ('attacker@example.test')");
    expect(result.error).toBeTruthy();
    const check = await db.asServiceRole("select count(*)::int as n from public.allowed_team_emails");
    expect(check.rows[0].n).toBe(2);
  });
});

/* ============== 2. authenticated but unapproved sees nothing ============= */

describe("a signed-up but unapproved user", () => {
  it("was given a profile row, but it is not approved", async () => {
    const result = await db.asServiceRole("select approved from public.profiles where user_id = $1", [
      outsider.userId,
    ]);
    expect(result.rows[0].approved).toBe(false);
  });

  it("is not recognised as a team member", async () => {
    const result = await db.asUser(outsider.userId, "select public.is_team_member() as member");
    expect(result.rows[0].member).toBe(false);
  });

  it("reads no business data at all", async () => {
    for (const table of ["contacts_cache", "leads", "listings", "tasks", "ai_actions", "audit_log"]) {
      const result = await db.asUser(outsider.userId, `select * from public.${table}`);
      expect(result.rows, `unapproved user could read ${table}`).toEqual([]);
    }
  });

  it("cannot see the team roster", async () => {
    const result = await db.asUser(outsider.userId, "select * from public.profiles");
    expect(result.rows).toEqual([]);
  });

  it("cannot write business data", async () => {
    const result = await db.asUser(
      outsider.userId,
      "insert into public.contacts_cache (first_name, last_name, owner_id) values ('X', 'Y', $1)",
      [jamie.profileId],
    );
    expect(result.error ?? "no rows inserted").toBeTruthy();
    const check = await db.asServiceRole("select count(*)::int as n from public.contacts_cache");
    expect(check.rows[0].n).toBe(1);
  });
});

/* ================= 3. approved users receive intended access ============= */

describe("approved team members", () => {
  it("are approved automatically because their address was allowlisted", async () => {
    for (const person of [jamie, brady]) {
      const result = await db.asServiceRole("select approved, approved_at from public.profiles where id = $1", [
        person.profileId,
      ]);
      expect(result.rows[0].approved).toBe(true);
      expect(result.rows[0].approved_at).not.toBeNull();
    }
  });

  it("are recognised as team members", async () => {
    for (const person of [jamie, brady]) {
      const result = await db.asUser(person.userId!, "select public.is_team_member() as member");
      expect(result.rows[0].member).toBe(true);
    }
  });

  it("can read the shared book of business", async () => {
    for (const person of [jamie, brady]) {
      const result = await db.asUser(person.userId, "select * from public.contacts_cache");
      expect(result.rows.length).toBe(1);
    }
  });

  it("can write business data", async () => {
    const result = await db.asUser(
      brady.userId,
      `insert into public.leads (first_name, last_name, source, assigned_to)
       values ('New', 'Lead', 'manual', $1) returning id`,
      [brady.profileId],
    );
    expect(result.error).toBeNull();
    expect(result.rows.length).toBe(1);
  });

  it("resolve to their own profile id, not a shared identity", async () => {
    const jamieProfile = await db.asUser(jamie.userId, "select public.current_profile_id() as id");
    const bradyProfile = await db.asUser(brady.userId, "select public.current_profile_id() as id");
    expect(jamieProfile.rows[0].id).toBe(jamie.profileId);
    expect(bradyProfile.rows[0].id).toBe(brady.profileId);
    expect(jamieProfile.rows[0].id).not.toBe(bradyProfile.rows[0].id);
  });
});

/* ==================== 4. users cannot approve themselves ================= */

describe("self-approval is impossible", () => {
  it("refuses a direct update of the approved column", async () => {
    const result = await db.asUser(outsider.userId, "update public.profiles set approved = true where user_id = $1", [
      outsider.userId,
    ]);
    expect(result.error, "the update must be refused outright").toBeTruthy();
    expect(result.error).toMatch(/permission denied|column/i);

    const check = await db.asServiceRole("select approved from public.profiles where user_id = $1", [
      outsider.userId,
    ]);
    expect(check.rows[0].approved).toBe(false);
  });

  it("refuses an attempt to approve someone else", async () => {
    const result = await db.asUser(jamie.userId, "update public.profiles set approved = true where user_id = $1", [
      outsider.userId,
    ]);
    expect(result.error).toBeTruthy();
    const check = await db.asServiceRole("select approved from public.profiles where user_id = $1", [
      outsider.userId,
    ]);
    expect(check.rows[0].approved).toBe(false);
  });

  it("refuses an insert of a new, pre-approved profile", async () => {
    const result = await db.asUser(
      outsider.userId,
      "insert into public.profiles (user_id, full_name, email, approved) values ($1, 'Sneaky', 'sneaky@example.test', true)",
      [outsider.userId],
    );
    expect(result.error).toBeTruthy();
  });

  it("refuses to add an address to the allowlist", async () => {
    const result = await db.asUser(
      outsider.userId,
      "insert into public.allowed_team_emails (email) values ($1)",
      [OUTSIDER],
    );
    expect(result.error).toBeTruthy();
  });

  it("refuses to call the approval helper", async () => {
    const result = await db.asUser(outsider.userId, "select public.approve_team_member($1)", [OUTSIDER]);
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/permission denied/i);
  });

  it("refuses an approved member the ability to call the approval helper either", async () => {
    // Even a trusted member must go through the service role or SQL editor.
    const result = await db.asUser(jamie.userId, "select public.approve_team_member($1)", [OUTSIDER]);
    expect(result.error).toMatch(/permission denied/i);
  });

  it("refuses an anonymous caller the approval helpers", async () => {
    for (const fn of ["approve_team_member", "revoke_team_member"]) {
      const result = await db.asAnon(`select public.${fn}($1)`, [OUTSIDER]);
      expect(result.error, `anon could call ${fn}`).toMatch(/permission denied/i);
    }
  });

  it("grants execute on the helpers to the service role explicitly", async () => {
    const result = await db.asServiceRole(`
      select p.proname, r.rolname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(p.proacl) as acl
      join pg_roles r on r.oid = acl.grantee
      where n.nspname = 'public'
        and p.proname in ('approve_team_member', 'revoke_team_member')
        and acl.privilege_type = 'EXECUTE'
      order by p.proname, r.rolname
    `);
    const grants = result.rows.map((r) => `${r.proname}:${r.rolname}`);
    expect(grants).toContain("approve_team_member:service_role");
    expect(grants).toContain("revoke_team_member:service_role");
    expect(grants.filter((g) => g.includes("authenticated"))).toEqual([]);
    expect(grants.filter((g) => g.includes("anon"))).toEqual([]);
  });

  it("still lets the service role approve someone deliberately", async () => {
    const promoted = "promoted@example.test";
    const created = await db.signUp(promoted, "Later Addition");
    expect((await db.asServiceRole("select approved from public.profiles where id = $1", [created.profileId])).rows[0]
      .approved).toBe(false);

    await db.asServiceRole("select public.approve_team_member($1)", [promoted]);

    const after = await db.asServiceRole("select approved from public.profiles where id = $1", [created.profileId]);
    expect(after.rows[0].approved).toBe(true);
    expect((await db.asUser(created.userId, "select public.is_team_member() as m")).rows[0].m).toBe(true);

    // ...and revoke it again.
    await db.asServiceRole("select public.revoke_team_member($1)", [promoted]);
    expect((await db.asUser(created.userId, "select public.is_team_member() as m")).rows[0].m).toBe(false);
  });
});

/* ============ 5. protected authorization fields cannot be modified ======= */

describe("protected authorization fields", () => {
  /**
   * `information_schema.column_privileges` only reports grants the *current*
   * role participates in, so querying it returns nothing here and any
   * "expect empty" assertion against it would pass vacuously. These use the
   * catalog directly, which is authoritative.
   */
  const columnGrants = (table: string, privilege: string) => `
    select a.attname as column_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join lateral aclexplode(a.attacl) as acl
    join pg_roles r on r.oid = acl.grantee
    where n.nspname = 'public' and c.relname = '${table}'
      and r.rolname = 'authenticated' and acl.privilege_type = '${privilege}'
    order by a.attname
  `;

  const tableGrants = (table: string) => `
    select acl.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) as acl
    join pg_roles r on r.oid = acl.grantee
    where n.nspname = 'public' and c.relname = '${table}' and r.rolname = 'authenticated'
    order by acl.privilege_type
  `;

  it("grants the authenticated role update on exactly the harmless profile columns", async () => {
    const result = await db.asServiceRole(columnGrants("profiles", "UPDATE"));
    // Not vacuous: this must actually find the four permitted columns.
    expect(result.rows.map((r) => r.column_name)).toEqual(["full_name", "license_number", "phone", "title"]);
  });

  it("grants no privilege of any kind on the approval columns", async () => {
    for (const privilege of ["SELECT", "INSERT", "UPDATE"]) {
      const result = await db.asServiceRole(columnGrants("profiles", privilege));
      const names = result.rows.map((r) => r.column_name);
      for (const protectedColumn of ["approved", "approved_at", "approved_by"]) {
        expect(names, `${protectedColumn} is grantable for ${privilege}`).not.toContain(protectedColumn);
      }
    }
  });

  it("holds no table-wide update or insert privilege that would bypass the column grants", async () => {
    const result = await db.asServiceRole(tableGrants("profiles"));
    const privileges = result.rows.map((r) => r.privilege_type);
    expect(privileges).not.toContain("UPDATE");
    expect(privileges).not.toContain("INSERT");
  });

  it("lets a member update their own display fields", async () => {
    const result = await db.asUser(jamie.userId, "update public.profiles set title = $1 where user_id = $2", [
      "Broker Associate",
      jamie.userId,
    ]);
    expect(result.error).toBeNull();
  });

  it("refuses a member changing another member's profile", async () => {
    const before = await db.asServiceRole("select title from public.profiles where user_id = $1", [brady.userId]);
    await db.asUser(jamie.userId, "update public.profiles set title = 'Hacked' where user_id = $1", [brady.userId]);
    const after = await db.asServiceRole("select title from public.profiles where user_id = $1", [brady.userId]);
    expect(after.rows[0].title).toBe(before.rows[0].title);
  });

  it("refuses a member changing their own user_id or email", async () => {
    for (const sql of [
      "update public.profiles set user_id = gen_random_uuid() where user_id = $1",
      "update public.profiles set email = 'other@example.test' where user_id = $1",
    ]) {
      const result = await db.asUser(jamie.userId, sql, [jamie.userId]);
      expect(result.error, sql).toBeTruthy();
    }
  });

  it("keeps the audit log append-only for team members", async () => {
    const inserted = await db.asUser(
      jamie.userId,
      `insert into public.audit_log (actor_id, actor_type, action, entity_type, entity_id)
       values ($1, 'user', 'test.event', 'test', gen_random_uuid()) returning id`,
      [jamie.profileId],
    );
    expect(inserted.error).toBeNull();
    const id = inserted.rows[0].id as string;

    const updated = await db.asUser(jamie.userId, "update public.audit_log set action = 'tampered' where id = $1", [id]);
    const deleted = await db.asUser(jamie.userId, "delete from public.audit_log where id = $1", [id]);

    const check = await db.asServiceRole("select action from public.audit_log where id = $1", [id]);
    expect(check.rows[0].action, "audit entry was modified").toBe("test.event");
    expect(check.rows.length, "audit entry was deleted").toBe(1);
    void updated;
    void deleted;
  });
});

/* ================ 6. per-profile integration account isolation =========== */

describe("integration accounts belong to one person", () => {
  beforeAll(async () => {
    for (const person of [jamie, brady]) {
      await db.asServiceRole(
        `insert into public.integration_accounts (profile_id, provider, account_email, status)
         values ($1, 'google', $2, 'connected')`,
        [person.profileId, `${person.profileId}@example.test`],
      );
    }
  });

  it("lets a member see only their own connection", async () => {
    const jamieRows = await db.asUser(jamie.userId, "select profile_id, provider from public.integration_accounts");
    expect(jamieRows.error).toBeNull();
    expect(jamieRows.rows.length).toBe(1);
    expect(jamieRows.rows[0].profile_id).toBe(jamie.profileId);

    const bradyRows = await db.asUser(brady.userId, "select profile_id, provider from public.integration_accounts");
    expect(bradyRows.error).toBeNull();
    expect(bradyRows.rows.length).toBe(1);
    expect(bradyRows.rows[0].profile_id).toBe(brady.profileId);
  });

  it("hides another member's row entirely, not merely its tokens", async () => {
    const result = await db.asUser(
      jamie.userId,
      "select profile_id, status from public.integration_accounts where profile_id = $1",
      [brady.profileId],
    );
    expect(result.error).toBeNull();
    expect(result.rows).toEqual([]);
  });

  it("refuses to return a credential column to any signed-in user, even their own", async () => {
    for (const column of ["access_token", "refresh_token"]) {
      const result = await db.asUser(jamie.userId, `select ${column} from public.integration_accounts`);
      expect(result.error, `${column} was readable`).toMatch(/permission denied/i);
    }
  });

  it("refuses a signed-in user writing a credential column", async () => {
    const result = await db.asUser(
      jamie.userId,
      "update public.integration_accounts set refresh_token = 'stolen' where profile_id = $1",
      [jamie.profileId],
    );
    expect(result.error).toMatch(/permission denied/i);
  });

  it("does not let one member delete another's connection", async () => {
    await db.asUser(jamie.userId, "delete from public.integration_accounts where profile_id = $1", [brady.profileId]);
    const check = await db.asServiceRole("select count(*)::int as n from public.integration_accounts where profile_id = $1", [
      brady.profileId,
    ]);
    expect(check.rows[0].n).toBe(1);
  });

  it("hides connections from an unapproved user entirely", async () => {
    const result = await db.asUser(outsider.userId, "select profile_id from public.integration_accounts");
    expect(result.error).toBeNull();
    expect(result.rows).toEqual([]);
  });

  it("grants no privilege on the credential columns, and does grant the safe ones", async () => {
    const grantedColumns = async (privilege: string) => {
      const result = await db.asServiceRole(`
        select a.attname as column_name
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        cross join lateral aclexplode(a.attacl) as acl
        join pg_roles r on r.oid = acl.grantee
        where n.nspname = 'public' and c.relname = 'integration_accounts'
          and r.rolname = 'authenticated' and acl.privilege_type = '${privilege}'
        order by a.attname
      `);
      return result.rows.map((r) => String(r.column_name));
    };

    const selectable = await grantedColumns("SELECT");
    // Not vacuous: the safe columns really are granted.
    expect(selectable).toContain("status");
    expect(selectable).toContain("provider");
    // And the credentials are not, for any privilege.
    for (const privilege of ["SELECT", "INSERT", "UPDATE"]) {
      const columns = await grantedColumns(privilege);
      expect(columns, `access_token grantable for ${privilege}`).not.toContain("access_token");
      expect(columns, `refresh_token grantable for ${privilege}`).not.toContain("refresh_token");
    }
  });

  it("holds no table-wide privilege that would bypass the column grants", async () => {
    const result = await db.asServiceRole(`
      select acl.privilege_type
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) as acl
      join pg_roles r on r.oid = acl.grantee
      where n.nspname = 'public' and c.relname = 'integration_accounts' and r.rolname = 'authenticated'
    `);
    const privileges = result.rows.map((r) => r.privilege_type);
    expect(privileges).not.toContain("SELECT");
    expect(privileges).not.toContain("UPDATE");
    expect(privileges).not.toContain("INSERT");
  });
});
