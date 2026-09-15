import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * A real PostgreSQL instance for testing row level security.
 *
 * PGlite is PostgreSQL compiled to WebAssembly — the genuine engine, with real
 * roles, real policies and real column privileges. These tests therefore prove
 * that the migrations *behave* correctly, rather than that the SQL text
 * contains the right words. Reading SQL cannot catch a policy that is subtly
 * permissive; executing it can.
 *
 * The harness reproduces the parts of a Supabase project that our policies
 * depend on:
 *
 *   * the `anon`, `authenticated` and `service_role` roles;
 *   * `service_role` holding BYPASSRLS, as it does in Supabase;
 *   * default privileges granting ALL on public tables to those roles — this
 *     matters enormously for fidelity, because it means RLS is the *only* thing
 *     restricting access, exactly as in production. Without it a test could
 *     pass because no grant existed rather than because a policy denied;
 *   * `auth.users` and `auth.uid()`, which PostgREST populates per request.
 */

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * PGlite does not ship the pgcrypto extension. The only thing migration 0001
 * uses it for is `gen_random_uuid()`, which PostgreSQL has provided natively
 * since version 13, so the resulting schema is identical. This is the single
 * substitution the harness makes, and it is asserted in the tests.
 */
const PGCRYPTO_LINE = /create extension if not exists "pgcrypto";/;

export interface QueryResult {
  rows: Record<string, unknown>[];
  error: string | null;
}

export interface TestDatabase {
  raw: PGlite;
  /** Run SQL as an unauthenticated visitor. */
  asAnon(sql: string, params?: unknown[]): Promise<QueryResult>;
  /** Run SQL as a signed-in Supabase user, with `auth.uid()` set to `userId`. */
  asUser(userId: string, sql: string, params?: unknown[]): Promise<QueryResult>;
  /** Run SQL with the service role, which bypasses RLS. */
  asServiceRole(sql: string, params?: unknown[]): Promise<QueryResult>;
  /** Create an auth user, firing the `handle_new_user` trigger. */
  signUp(email: string, fullName?: string): Promise<{ userId: string; profileId: string | null }>;
  close(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const db = new PGlite();

  // --- the Supabase-shaped environment our policies assume ------------------
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    alter role service_role bypassrls;

    alter default privileges in schema public
      grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on functions to anon, authenticated, service_role;

    create schema auth;

    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique not null,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create or replace function auth.uid() returns uuid
    language sql stable
    as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      )::uuid
    $$;

    grant usage on schema auth to anon, authenticated, service_role;
  `);

  // --- the real migrations, in filename order -------------------------------
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) throw new Error("No migrations found");

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql.replace(PGCRYPTO_LINE, "-- pgcrypto: gen_random_uuid() is native in PG13+"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  async function runAs(role: string, sub: string | null, sql: string, params?: unknown[]): Promise<QueryResult> {
    await db.exec("begin");
    try {
      await db.exec(`set local role ${role}`);
      if (sub) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [sub]);
      const result = await db.query(sql, params);
      await db.exec("commit");
      return { rows: (result.rows ?? []) as Record<string, unknown>[], error: null };
    } catch (error) {
      await db.exec("rollback");
      return { rows: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    raw: db,
    asAnon: (sql, params) => runAs("anon", null, sql, params),
    asUser: (userId, sql, params) => runAs("authenticated", userId, sql, params),
    asServiceRole: (sql, params) => runAs("service_role", null, sql, params),

    async signUp(email: string, fullName = email.split("@")[0]) {
      const inserted = await db.query<{ id: string }>(
        "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
        [email, JSON.stringify({ full_name: fullName })],
      );
      const userId = inserted.rows[0].id;
      const profile = await db.query<{ id: string }>("select id from public.profiles where user_id = $1", [userId]);
      return { userId, profileId: profile.rows[0]?.id ?? null };
    },

    async close() {
      await db.close();
    },
  };
}

/** The migration files, so tests can assert the harness ran all of them. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}
