import { describe, expect, it } from "vitest";
import { buildSeedDataset } from "@/lib/data/seed";
import { MockMlsProvider } from "@/lib/integrations/mls/mock";
import { LEAD_STAGES, LISTING_STATUS_LABELS } from "@/lib/types";

const dataset = buildSeedDataset();

describe("seed dataset", () => {
  it("marks every record as demo data", () => {
    const collections = [
      dataset.contacts,
      dataset.leads,
      dataset.listings,
      dataset.properties,
      dataset.buyers,
      dataset.tasks,
      dataset.calendarEvents,
      dataset.transactions,
    ];
    for (const collection of collections) {
      for (const record of collection) expect(record.isSeed).toBe(true);
    }
  });

  it("includes the three named Austin properties", () => {
    const addresses = dataset.properties.map((p) => p.address);
    expect(addresses).toContain("2700 Lothian Drive");
    expect(addresses).toContain("1800 Brackenridge Street");
    expect(addresses).toContain("2111 American Drive");
  });

  it("has no dangling references between records", () => {
    const propertyIds = new Set(dataset.properties.map((p) => p.id));
    const contactIds = new Set(dataset.contacts.map((c) => c.id));
    const listingIds = new Set(dataset.listings.map((l) => l.id));
    const profileIds = new Set(dataset.profiles.map((p) => p.id));

    for (const listing of dataset.listings) {
      expect(propertyIds.has(listing.propertyId), `listing ${listing.id} property`).toBe(true);
      expect(profileIds.has(listing.ownerId)).toBe(true);
      for (const sellerId of listing.sellerContactIds) expect(contactIds.has(sellerId)).toBe(true);
    }
    for (const buyer of dataset.buyers) expect(contactIds.has(buyer.contactId)).toBe(true);
    for (const tx of dataset.transactions) {
      expect(propertyIds.has(tx.propertyId)).toBe(true);
      for (const id of tx.clientContactIds) expect(contactIds.has(id)).toBe(true);
    }
    for (const task of dataset.tasks) {
      if (task.contactId) expect(contactIds.has(task.contactId)).toBe(true);
      if (task.listingId) expect(listingIds.has(task.listingId)).toBe(true);
    }
    for (const feedback of dataset.showingFeedback) expect(listingIds.has(feedback.listingId)).toBe(true);
    for (const event of dataset.emailEvents) {
      if (event.contactId) expect(contactIds.has(event.contactId)).toBe(true);
    }
  });

  it("uses valid enum values throughout", () => {
    for (const lead of dataset.leads) expect(LEAD_STAGES).toContain(lead.stage);
    for (const listing of dataset.listings) expect(Object.keys(LISTING_STATUS_LABELS)).toContain(listing.status);
  });

  it("produces a working demo: appointments today, overdue work, and live listings", () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
    const todayEvents = dataset.calendarEvents.filter(
      (e) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(e.startsAt)) === today,
    );
    expect(todayEvents.length).toBeGreaterThanOrEqual(3);

    const now = Date.now();
    expect(dataset.tasks.filter((t) => t.status === "open" && new Date(t.dueAt).getTime() < now).length).toBeGreaterThan(2);
    expect(dataset.listings.filter((l) => ["active", "price_change", "coming_soon"].includes(l.status)).length).toBeGreaterThanOrEqual(3);
    expect(dataset.leads.filter((l) => l.stage === "new").length).toBeGreaterThanOrEqual(2);
  });

  it("gives every listing the seller-specific writing rules the studio depends on", () => {
    for (const listing of dataset.listings) {
      expect(listing.brokerageDisclaimer.length).toBeGreaterThan(40);
      expect(Array.isArray(listing.prohibitedPhrases)).toBe(true);
    }
  });
});

describe("mock MLS", () => {
  const mls = new MockMlsProvider();

  it("returns a competitive set for each seeded listing's postal code", async () => {
    for (const postalCode of ["78613", "78704", "78645"]) {
      const comps = await mls.getComparables({ postalCode });
      expect(comps.actives.length, postalCode).toBeGreaterThan(0);
      expect(comps.solds.length + comps.pendings.length, postalCode).toBeGreaterThan(0);
    }
  });

  it("honours search criteria", async () => {
    const results = await mls.searchProperties({ postalCode: "78613", priceMax: 900000 });
    expect(results.length).toBeGreaterThan(0);
    for (const p of results) {
      expect(p.postalCode).toBe("78613");
      expect(p.listPrice).toBeLessThanOrEqual(900000);
    }
  });

  it("separates price reductions from the rest of the set", async () => {
    const comps = await mls.getComparables({ postalCode: "78613", withinDays: 90 });
    expect(comps.priceReductions.length).toBeGreaterThan(0);
    for (const p of comps.priceReductions) expect(p.priceReducedAt).toBeTruthy();
  });
});
