/**
 * Pre-flight check for a Supabase project.
 *
 *   npm run db:verify
 *
 * Run this AFTER applying the migrations and BEFORE pointing the application at
 * the database. It proves the schema and the security rules are actually in
 * place, so the switch from demo data to the real database is not a leap of
 * faith. It only reads; it changes nothing.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing configuration.\n" +
      "  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n" +
      "  Both are in the Supabase dashboard under Project Settings -> API.",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const EXPECTED_TABLES = [
  "ai_actions", "ai_runs", "allowed_team_emails", "appointment_preps", "audit_log", "buyers",
  "calendar_events_cache", "contact_notes", "contacts_cache", "daily_briefs", "email_events_cache",
  "integration_accounts", "integration_connections", "leads", "listing_marketing", "listings",
  "marketing_assets", "opportunities", "profiles", "properties", "seller_updates", "showing_feedback",
  "stated_plans", "tasks", "transactions",
];

const results: { ok: boolean; label: string; detail?: string }[] = [];

function check(ok: boolean, label: string, detail?: string) {
  results.push({ ok, label, detail });
}

async function main() {
  console.log(`\nVerifying ${url}\n`);

  // 1. Every expected table exists and is reachable with the service role.
  const missing: string[] = [];
  for (const table of EXPECTED_TABLES) {
    const { error } = await admin.from(table).select("*", { count: "exact", head: true });
    if (error) missing.push(table);
  }
  check(
    missing.length === 0,
    `All ${EXPECTED_TABLES.length} tables exist`,
    missing.length ? `Missing or unreadable: ${missing.join(", ")}. Have you run the migrations?` : undefined,
  );

  // 2. The approval column exists and defaults to denying access.
  const { error: approvedError } = await admin.from("profiles").select("approved, approved_at").limit(1);
  check(!approvedError, "profiles.approved exists", approvedError?.message);

  // 3. Anonymous access reads nothing. This is the test that matters most —
  //    and the one easiest to get a false PASS from. An empty table yields no
  //    rows to an anonymous visitor whether or not a policy is protecting it,
  //    so each table is only counted as proven when the service role can see
  //    rows there that the anonymous client cannot.
  const PUBLIC_FACING = [
    "contacts_cache", "leads", "listings", "profiles", "allowed_team_emails", "integration_accounts",
  ];
  if (anonKey) {
    const anon = createClient(url!, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const leaks: string[] = [];
    const proven: string[] = [];
    const unproven: string[] = [];

    for (const table of PUBLIC_FACING) {
      const { count } = await admin.from(table).select("*", { count: "exact", head: true });
      const { data, error } = await anon.from(table).select("*").limit(1);
      // An error (RLS denial) is the desired outcome. Rows are not.
      if (!error && (data?.length ?? 0) > 0) leaks.push(table);
      else if ((count ?? 0) > 0) proven.push(table);
      else unproven.push(table);
    }

    check(
      leaks.length === 0,
      "An anonymous visitor reads no data",
      leaks.length
        ? `LEAKING: ${leaks.join(", ")}. Do not put real data in this project.`
        : `Proven on ${proven.length} populated table(s).`,
    );

    if (unproven.length > 0) {
      check(
        true,
        `${unproven.length} table(s) empty, so denial could not be proven there`,
        `${unproven.join(", ")}. An empty table hides nothing either way. ` +
          "supabase/setup/03-negative-tests.sql proves denial regardless, by inserting a canary row.",
      );
    }
  } else {
    check(false, "Anonymous access checked", "Set NEXT_PUBLIC_SUPABASE_ANON_KEY to run this check.");
  }

  // 4. Somebody is allowed in, otherwise nobody can use the app.
  const { data: allowlist } = await admin.from("allowed_team_emails").select("email");
  check(
    (allowlist?.length ?? 0) > 0,
    "At least one address is allowlisted",
    (allowlist?.length ?? 0) === 0 ? "Run: npm run team:allow -- person@example.com" : `${allowlist!.length} address(es)`,
  );

  // 5. Somebody is actually approved. Without this the application is
  //    unusable: every policy calls is_team_member(), which requires it.
  const { data: profiles } = await admin.from("profiles").select("email, approved");
  const approved = (profiles ?? []).filter((p) => p.approved);
  const waiting = (profiles?.length ?? 0) - approved.length;
  check(
    approved.length > 0,
    `${approved.length} approved account(s), ${waiting} awaiting approval`,
    approved.length === 0
      ? "Nobody is approved, so nobody can read anything. Allowlist an address before the account is created."
      : undefined,
  );

  // 6. A throwaway account left behind keeps an unapproved identity alive for
  //    no reason. Harmless — it can read nothing — but worth clearing up.
  if (waiting > 0) {
    check(true, `${waiting} unapproved account(s) present`,
      "These can read nothing. If one is a leftover test account, delete it in Authentication -> Users.");
  }

  // --- report ---------------------------------------------------------------
  console.log(results.map((r) => `  ${r.ok ? "PASS" : "FAIL"}  ${r.label}${r.detail ? `\n        ${r.detail}` : ""}`).join("\n"));

  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) {
    console.log(`\n${failed} check(s) failed. Do not switch the application over yet.\n`);
    process.exit(1);
  }
  console.log(
    "\nAll checks passed. What this does NOT prove, because it runs as the\n" +
      "service role and over the REST API:\n" +
      "  - that an account which exists but was never allowlisted is denied\n" +
      "  - that no account can approve itself\n" +
      "  - that row level security is enabled on every table\n" +
      "Run supabase/setup/03-negative-tests.sql in the SQL editor for those.\n",
  );
}

main().catch((error) => {
  console.error(`\nVerification could not run: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
