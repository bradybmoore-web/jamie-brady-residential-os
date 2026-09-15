/**
 * Manage who is allowed into the Residential OS.
 *
 *   npm run team:list
 *   npm run team:allow  -- jamie@example.com "Jamie Moore"
 *   npm run team:revoke -- someone@example.com
 *
 * Email addresses are supplied on the command line and never written into the
 * source tree. Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY,
 * because changing authorization deliberately requires the service role — a
 * signed-in user cannot do any of this.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing configuration.\n" +
      "  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n" +
      "  Both are in the Supabase dashboard under Project Settings -> API.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const [command, rawEmail, ...rest] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
const note = rest.join(" ").trim() || null;

function requireEmail(): string {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`Provide a valid email address. Example:\n  npm run team:${command} -- person@example.com`);
    process.exit(1);
  }
  return email;
}

async function list() {
  const [{ data: allowed, error: allowError }, { data: profiles, error: profileError }] = await Promise.all([
    supabase.from("allowed_team_emails").select("email, note, created_at").order("email"),
    supabase.from("profiles").select("email, full_name, approved, approved_at").order("email"),
  ]);
  if (allowError) throw new Error(allowError.message);
  if (profileError) throw new Error(profileError.message);

  console.log("\nAllowlisted addresses (may sign up and be approved automatically):");
  if (!allowed?.length) console.log("  (none — nobody can gain access yet)");
  for (const row of allowed ?? []) console.log(`  ${row.email}${row.note ? `  — ${row.note}` : ""}`);

  console.log("\nAccounts that exist:");
  if (!profiles?.length) console.log("  (none)");
  for (const p of profiles ?? []) {
    const state = p.approved ? "APPROVED" : "no access";
    console.log(`  ${String(p.email).padEnd(34)} ${state.padEnd(10)} ${p.full_name ?? ""}`);
  }
  console.log();
}

async function allow() {
  const target = requireEmail();
  const { error } = await supabase
    .from("allowed_team_emails")
    .upsert({ email: target, note }, { onConflict: "email" });
  if (error) throw new Error(error.message);

  // Approve immediately if they have already signed up.
  const { error: approveError } = await supabase.rpc("approve_team_member", { target_email: target });
  if (approveError) throw new Error(approveError.message);

  const { data } = await supabase.from("profiles").select("approved").ilike("email", target).maybeSingle();
  console.log(`\nAllowlisted ${target}.`);
  console.log(
    data
      ? `Their existing account is now ${data.approved ? "approved" : "still unapproved — check the address"}.`
      : "They have not signed up yet. When they do, they will be approved automatically.",
  );
  console.log();
}

async function revoke() {
  const target = requireEmail();
  const { error } = await supabase.rpc("revoke_team_member", { target_email: target });
  if (error) throw new Error(error.message);
  console.log(`\nRevoked ${target}. They can still sign in, but can no longer read any data.\n`);
}

const commands: Record<string, () => Promise<void>> = { list, allow, revoke };

async function main() {
  const run = commands[command ?? ""];
  if (!run) {
    console.error("Usage:\n  npm run team:list\n  npm run team:allow  -- person@example.com \"Their Name\"\n  npm run team:revoke -- person@example.com");
    process.exit(1);
  }
  await run();
}

main().catch((error) => {
  console.error(`\nFailed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
