/**
 * Load the demo business data into a Supabase project.
 *
 *   npm run db:seed
 *
 * This loads fictional contacts, listings, leads and activity so the product is
 * demonstrable. It does NOT create accounts and it does NOT grant anybody
 * access — authorization is handled separately and deliberately:
 *
 *   npm run team:allow -- person@example.com
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and the
 * migrations must already be applied. Re-running is safe: rows are upserted by
 * id, so nothing duplicates.
 *
 * Every row it writes is marked `is_seed = true`. The application labels those
 * rows "Demo" everywhere they appear, and you can remove all of it later with
 * `delete from <table> where is_seed;`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildSeedDataset } from "../src/lib/data/seed";
import { recordToRow } from "../src/lib/data/mapping";
import type { Dataset } from "../src/lib/types";

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

async function main() {
  const dataset = buildSeedDataset();
  console.log(`\nSeeding demo business data into ${url}\n`);

  const owners = await approvedProfiles(supabase);
  remapOwners(dataset, owners);

  // Order matters: foreign keys point backwards through this list.
  await upsert("properties", dataset.properties);
  await upsert("contacts_cache", dataset.contacts.map(stripContactChildren));
  await upsert(
    "contact_notes",
    dataset.contacts.flatMap((c) => c.notes.map((n) => ({ ...n, authorId: owners[0] }))),
  );
  await upsert("stated_plans", dataset.contacts.flatMap((c) => c.statedPlans));
  await upsert("listings", dataset.listings);
  await upsert("showing_feedback", dataset.showingFeedback);
  await upsert("seller_updates", dataset.sellerUpdates);
  await upsert("buyers", dataset.buyers);
  await upsert("transactions", dataset.transactions);
  await upsert("leads", dataset.leads);
  await upsert("tasks", dataset.tasks);
  await upsert("calendar_events_cache", dataset.calendarEvents);
  await upsert("email_events_cache", dataset.emailEvents);
  await upsert("listing_marketing", dataset.listingMarketing);
  await upsert("marketing_assets", dataset.marketingAssets);
  await upsert("integration_connections", dataset.integrations);

  console.log(
    "\nDone. Every row above is demo data and is labelled as such in the app.\n" +
      "Remove it later with:  delete from contacts_cache where is_seed;  (and so on per table)\n",
  );
}

/**
 * Seed rows reference the two seeded agent profiles. Point them at the real
 * approved accounts instead, so the demo data belongs to whoever actually uses
 * the system. This script never creates an account — that would mean inventing
 * a password for a real project, which is not its job.
 */
async function approvedProfiles(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client
    .from("profiles")
    .select("id, email, full_name")
    .eq("approved", true)
    .order("created_at");
  if (error) throw new Error(`Could not read profiles: ${error.message}`);

  if (!data || data.length === 0) {
    throw new Error(
      "No approved accounts exist yet, so there is nobody to own the demo data.\n" +
        "  1. Allowlist the addresses:  npm run team:allow -- person@example.com\n" +
        "  2. Have each person sign up in the app.\n" +
        "  3. Re-run this command.",
    );
  }

  for (const profile of data) console.log(`  owner    ${profile.email} (${profile.full_name})`);
  return data.map((p) => p.id as string);
}

/** Every owner_id / assigned_to in the dataset points at a seeded profile id. */
function remapOwners(dataset: Dataset, owners: string[]) {
  const seedIds = dataset.profiles.map((p) => p.id);
  // Seed agent 1 -> first approved account, seed agent 2 -> second if present.
  const mapping = new Map(seedIds.map((id, i) => [id, owners[Math.min(i, owners.length - 1)]]));
  const remap = (id: string) => mapping.get(id) ?? owners[0];

  for (const row of [
    ...dataset.contacts,
    ...dataset.listings,
    ...dataset.buyers,
    ...dataset.transactions,
    ...dataset.tasks,
    ...dataset.calendarEvents,
    ...dataset.listingMarketing,
  ]) {
    if ("ownerId" in row) (row as { ownerId: string }).ownerId = remap((row as { ownerId: string }).ownerId);
  }
  for (const lead of dataset.leads) lead.assignedTo = remap(lead.assignedTo);
  for (const update of dataset.sellerUpdates) {
    if (update.approvedBy) update.approvedBy = remap(update.approvedBy);
  }
}

function stripContactChildren(contact: Dataset["contacts"][number]) {
  const { notes: _notes, statedPlans: _plans, ...rest } = contact;
  void _notes;
  void _plans;
  return rest;
}

async function upsert(table: string, records: object[]) {
  if (records.length === 0) {
    console.log(`  ${table.padEnd(24)} 0`);
    return;
  }
  const rows = records.map((r) => recordToRow(r as Record<string, unknown>));
  const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`Failed to seed ${table}: ${error.message}`);
  console.log(`  ${table.padEnd(24)} ${records.length}`);
}

main().catch((error) => {
  console.error(`\nSeeding failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
