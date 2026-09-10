/**
 * Load the demo dataset into a Supabase project.
 *
 *   npm run db:seed
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and that the
 * migrations in supabase/migrations/ have already been applied.
 *
 * Profiles are tied to auth users, so this creates (or finds) an auth user per
 * agent and remaps every owner reference in the dataset onto the real profile
 * ids. Re-running it is safe: rows are upserted by id.
 *
 * Every row it writes is marked `is_seed = true`, so you can remove all of it
 * later with `delete from <table> where is_seed;`.
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
      "  Find them under Project Settings -> API in the Supabase dashboard.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const dataset = buildSeedDataset();
  console.log(`Seeding ${url}\n`);

  const profileIdBySeedId = await seedProfiles(supabase, dataset);
  remapOwners(dataset, profileIdBySeedId);

  // Order matters: foreign keys point backwards through this list.
  await upsert("properties", dataset.properties);
  await upsert("contacts_cache", dataset.contacts.map(stripContactChildren));
  await upsert(
    "contact_notes",
    dataset.contacts.flatMap((c) =>
      c.notes.map((n) => ({ ...n, authorId: profileIdBySeedId.get(n.authorId) ?? n.authorId })),
    ),
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

  console.log("\nDone. Sign in with either agent's email and the password you set below.");
}

/**
 * Profiles hang off auth.users, so each seeded agent needs a real auth user.
 * The `handle_new_user` trigger creates the profile row; we then align it with
 * the seed data.
 */
async function seedProfiles(client: SupabaseClient, dataset: Dataset) {
  const map = new Map<string, string>();

  for (const profile of dataset.profiles) {
    const { data: existing } = await client
      .from("profiles")
      .select("id")
      .eq("email", profile.email)
      .maybeSingle();

    if (existing) {
      map.set(profile.id, existing.id as string);
      console.log(`  profile  ${profile.email} (existing)`);
      continue;
    }

    const password = `${crypto.randomUUID()}Aa1!`;
    const { data: created, error } = await client.auth.admin.createUser({
      email: profile.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: profile.fullName },
    });
    if (error || !created.user) {
      throw new Error(`Could not create auth user ${profile.email}: ${error?.message}`);
    }

    const { data: row, error: profileError } = await client
      .from("profiles")
      .select("id")
      .eq("user_id", created.user.id)
      .maybeSingle();
    if (profileError || !row) {
      throw new Error(
        `Auth user created but no profile row appeared for ${profile.email}. ` +
          "Check that migration 0002_rls.sql (which installs the handle_new_user trigger) has been applied.",
      );
    }

    await client
      .from("profiles")
      .update({ full_name: profile.fullName, title: profile.title, phone: profile.phone, role: profile.role })
      .eq("id", row.id);

    map.set(profile.id, row.id as string);
    console.log(`  profile  ${profile.email} (created)`);
    console.log(`           temporary password: ${password}`);
    console.log(`           change it immediately, or send a password reset.`);
  }

  return map;
}

/** Every owner_id / assigned_to in the dataset points at a seed profile id. */
function remapOwners(dataset: Dataset, map: Map<string, string>) {
  const remap = (id: string) => map.get(id) ?? id;
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
  if (error) {
    throw new Error(`Failed to seed ${table}: ${error.message}`);
  }
  console.log(`  ${table.padEnd(24)} ${records.length}`);
}

main().catch((error) => {
  console.error(`\nSeeding failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
