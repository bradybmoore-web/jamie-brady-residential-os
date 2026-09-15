-- Bring `profiles` in line with every other table.
--
-- Found by tests/db/schema-conformance.test.ts, which maps the TypeScript
-- domain model onto the real schema: `Profile` extends `BaseRecord`, so the
-- store writes `source_system` and `is_seed` for it as it does for every other
-- record — but migration 0001 never gave `profiles` those columns. The mismatch
-- was invisible while the app ran on MemoryStore and would have surfaced as a
-- failed insert the first time a profile was written to Postgres.
--
-- Added as a new migration rather than by editing 0001, so that any database
-- already carrying 0001 moves forward cleanly instead of silently diverging.

alter table public.profiles
  add column if not exists source_system source_system not null default 'manual',
  add column if not exists source_id text,
  add column if not exists is_seed boolean not null default false;

-- These are provenance, not authorization, but they are still not the
-- signed-in user's to rewrite: the column grants from 0003 deliberately list
-- only the display fields, and adding columns does not widen them.
