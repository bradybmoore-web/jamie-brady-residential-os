import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSeedDataset } from "@/lib/data/seed";
import { recordToRow } from "@/lib/data/mapping";
import { createTestDatabase, type TestDatabase } from "./harness";

/**
 * Does the TypeScript domain model actually fit the database?
 *
 * `SupabaseStore` maps camelCase fields to snake_case columns and writes them
 * straight through. If a field has no matching column — a rename, a typo, a
 * model change that never reached a migration — nothing fails until the
 * application is pointed at the real database and a write blows up in front of
 * Jamie.
 *
 * These tests compare what the mapper produces against the columns that
 * actually exist, and then insert a real seed record into a real PostgreSQL
 * server. This is the check that makes switching off MemoryStore safe.
 */

let db: TestDatabase;
let columnsByTable: Map<string, Set<string>>;

const dataset = buildSeedDataset();

/** Fields held in child tables or computed, so never written as columns. */
const NOT_COLUMNS: Record<string, string[]> = {
  contacts_cache: ["notes", "statedPlans"],
};

const CASES: { table: string; sample: () => Record<string, unknown> }[] = [
  { table: "profiles", sample: () => ({ ...dataset.profiles[0] }) },
  { table: "contacts_cache", sample: () => ({ ...dataset.contacts[0] }) },
  { table: "contact_notes", sample: () => ({ ...dataset.contacts[0].notes[0] }) },
  { table: "stated_plans", sample: () => ({ ...dataset.contacts.find((c) => c.statedPlans.length)!.statedPlans[0] }) },
  { table: "leads", sample: () => ({ ...dataset.leads[0] }) },
  { table: "properties", sample: () => ({ ...dataset.properties[0] }) },
  { table: "listings", sample: () => ({ ...dataset.listings[0] }) },
  { table: "showing_feedback", sample: () => ({ ...dataset.showingFeedback[0] }) },
  { table: "seller_updates", sample: () => ({ ...dataset.sellerUpdates[0] }) },
  { table: "buyers", sample: () => ({ ...dataset.buyers[0] }) },
  { table: "transactions", sample: () => ({ ...dataset.transactions[0] }) },
  { table: "tasks", sample: () => ({ ...dataset.tasks[0] }) },
  { table: "calendar_events_cache", sample: () => ({ ...dataset.calendarEvents[0] }) },
  { table: "email_events_cache", sample: () => ({ ...dataset.emailEvents[0] }) },
  { table: "listing_marketing", sample: () => ({ ...dataset.listingMarketing[0] }) },
  { table: "marketing_assets", sample: () => ({ ...dataset.marketingAssets[0] }) },
  { table: "integration_connections", sample: () => ({ ...dataset.integrations[0] }) },
];

beforeAll(async () => {
  db = await createTestDatabase();
  const result = await db.asServiceRole(`
    select c.relname as table_name, a.attname as column_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
  `);
  columnsByTable = new Map();
  for (const row of result.rows) {
    const table = String(row.table_name);
    if (!columnsByTable.has(table)) columnsByTable.set(table, new Set());
    columnsByTable.get(table)!.add(String(row.column_name));
  }
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("the domain model matches the database schema", () => {
  for (const { table, sample } of CASES) {
    it(`every field written to ${table} has a real column`, () => {
      const record = sample();
      for (const omit of NOT_COLUMNS[table] ?? []) delete record[omit];

      const row = recordToRow(record);
      const columns = columnsByTable.get(table);
      expect(columns, `table ${table} does not exist`).toBeDefined();

      const unknown = Object.keys(row).filter((column) => !columns!.has(column));
      expect(unknown, `${table} has no column(s): ${unknown.join(", ")}`).toEqual([]);
    });
  }

  it("covers every table the store writes to", async () => {
    const { TABLE } = await import("@/lib/data/table-names");
    const written = new Set(Object.values(TABLE));
    const covered = new Set([
      ...CASES.map((c) => c.table),
      // Written only at runtime, from data the workflows generate.
      "opportunities", "ai_runs", "ai_actions", "daily_briefs", "appointment_preps", "audit_log",
    ]);
    const uncovered = [...written].filter((t) => !covered.has(t));
    expect(uncovered, `no conformance case for: ${uncovered.join(", ")}`).toEqual([]);
  });
});

describe("real seed records insert into a real database", () => {
  it("accepts a property, a listing and a contact end to end", async () => {
    const profile = await db.signUp("conformance@example.test", "Conformance Check");
    // The seed data references its own profile ids; point the rows at a real one.
    const property = { ...dataset.properties[0] };
    const listing = { ...dataset.listings[0], ownerId: profile.profileId!, sellerContactIds: [] };
    const contact = { ...dataset.contacts[0], ownerId: profile.profileId! };
    delete (contact as Record<string, unknown>).notes;
    delete (contact as Record<string, unknown>).statedPlans;

    for (const [table, record] of [
      ["properties", property],
      ["listings", listing],
      ["contacts_cache", contact],
    ] as const) {
      const row = recordToRow(record as Record<string, unknown>);
      const columns = Object.keys(row);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      const result = await db.asServiceRole(
        `insert into public.${table} (${columns.join(", ")}) values (${placeholders})`,
        columns.map((c) => row[c]),
      );
      expect(result.error, `${table}: ${result.error}`).toBeNull();
    }
  });

  it("enforces the outbound-approval constraint at the database level", async () => {
    const profile = await db.signUp("constraint@example.test", "Constraint Check");
    const run = await db.asServiceRole(
      `insert into public.ai_runs (workflow, prompt_version, model, provider, owner_id)
       values ('assistant', 'test@1', 'test', 'mock', $1) returning id`,
      [profile.profileId],
    );
    const runId = run.rows[0].id;

    // An outbound draft that claims not to need approval must be rejected.
    const refused = await db.asServiceRole(
      `insert into public.ai_actions (ai_run_id, workflow, type, title, owner_id, requires_approval)
       values ($1, 'assistant', 'email_draft', 'Sneaky', $2, false)`,
      [runId, profile.profileId],
    );
    expect(refused.error).toMatch(/ai_actions_outbound_requires_approval|violates check constraint/i);

    // The same draft requiring approval is fine.
    const allowed = await db.asServiceRole(
      `insert into public.ai_actions (ai_run_id, workflow, type, title, owner_id, requires_approval)
       values ($1, 'assistant', 'email_draft', 'Proper draft', $2, true)`,
      [runId, profile.profileId],
    );
    expect(allowed.error).toBeNull();
  });
});
