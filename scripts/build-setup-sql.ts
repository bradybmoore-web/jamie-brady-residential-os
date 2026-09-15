/**
 * Generate the single-paste setup file from the individual migrations.
 *
 *   npm run db:build-setup
 *
 * The numbered migrations remain the source of truth and the version history.
 * This just concatenates them in order so the whole schema can be applied in
 * one paste in the Supabase SQL editor, which is far less error-prone than
 * pasting five files in the right sequence.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = "supabase/migrations";
const OUTPUT = "supabase/setup/all-migrations.sql";

const files = readdirSync(MIGRATIONS)
  .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
  .sort();

const header = `-- =============================================================================
-- Jamie & Brady Residential OS — complete database setup
--
-- GENERATED FILE. Do not edit by hand: run \`npm run db:build-setup\`.
-- Source of truth is supabase/migrations/, applied here in numerical order:
${files.map((f) => `--   ${f}`).join("\n")}
--
-- Paste the whole thing into the Supabase SQL editor and run it once. It is
-- safe to run again: every statement is written to be idempotent or to fail
-- loudly rather than half-apply.
-- =============================================================================

`;

const body = files
  .map((file) => {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8").trimEnd();
    const banner = `-- ${"-".repeat(74)}\n-- ${file}\n-- ${"-".repeat(74)}`;
    return `${banner}\n\n${sql}\n`;
  })
  .join("\n");

const footer = `
-- =============================================================================
-- Setup complete. Next: add the two permitted addresses to the allowlist with
-- supabase/setup/02-allowlist.sql, then create those two users in
-- Authentication -> Users. Signing up does not grant access; being allowlisted
-- at the moment the account is created does.
-- =============================================================================
`;

writeFileSync(OUTPUT, header + body + footer);
console.log(`Wrote ${OUTPUT} from ${files.length} migrations (${files.join(", ")}).`);
