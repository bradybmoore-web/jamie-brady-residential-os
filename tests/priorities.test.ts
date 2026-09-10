import { describe, expect, it } from "vitest";
import { buildListingActions, buildMetrics, buildPriorities } from "@/lib/scoring/priorities";
import { ID, seededContext } from "./helpers";

describe("daily priorities", () => {
  it("ranks a brand new uncontacted inquiry near the top", () => {
    const priorities = buildPriorities(seededContext());
    const top = priorities.slice(0, 4).map((p) => p.key);
    // Ngozi Okafor came in minutes ago on a coming-soon listing she is
    // pre-approved for. Speed to lead is the whole game.
    expect(top).toContain(`lead:${ID.leadOkafor}`);
  });

  it("returns results sorted by score", () => {
    const priorities = buildPriorities(seededContext());
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i - 1].score).toBeGreaterThanOrEqual(priorities[i].score);
    }
  });

  it("shows one card per person, not one per reason", () => {
    const priorities = buildPriorities(seededContext());
    const people = priorities.map((p) => p.personId).filter(Boolean);
    expect(new Set(people).size).toBe(people.length);
  });

  it("keeps the evidence from a folded-in duplicate rather than discarding it", () => {
    // Karen Whitfield surfaces from several directions at once: an unanswered
    // email, a live listing, an overdue seller update task.
    const priorities = buildPriorities(seededContext());
    const karen = priorities.find((p) => p.personId === ID.whitfield);
    expect(karen).toBeDefined();
    expect(karen!.evidence.length).toBeGreaterThan(1);
  });

  it("gives every priority a reason, an action and grounded evidence", () => {
    for (const priority of buildPriorities(seededContext())) {
      expect(priority.reason.length).toBeGreaterThan(10);
      expect(priority.recommendedAction.length).toBeGreaterThan(10);
      expect(priority.evidence.length).toBeGreaterThan(0);
      for (const e of priority.evidence) expect(e.recordId).toBeTruthy();
    }
  });

  it("only shows work belonging to the signed-in agent when scoped", () => {
    const ctx = seededContext();
    const mine = buildPriorities(ctx, { ownerOnly: true });
    const bradysLeads = ctx.dataset.leads.filter((l) => l.assignedTo !== ID.jamie).map((l) => l.id);
    for (const priority of mine) {
      if (priority.leadId) expect(bradysLeads).not.toContain(priority.leadId);
    }
  });

  it("does not surface a lead that has already converted or been lost", () => {
    const ctx = seededContext();
    ctx.dataset.leads = ctx.dataset.leads.map((l) => ({ ...l, stage: "lost" as const }));
    const priorities = buildPriorities(ctx);
    expect(priorities.filter((p) => p.leadId)).toHaveLength(0);
  });
});

describe("metrics", () => {
  it("counts the six figures the Today header shows", () => {
    const metrics = buildMetrics(seededContext());
    expect(metrics.appointmentsToday).toBeGreaterThan(0);
    expect(metrics.tasksDue).toBeGreaterThan(0);
    expect(metrics.sellerReportsDue).toBeGreaterThanOrEqual(1);
    for (const value of Object.values(metrics)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("listing actions", () => {
  it("flags a seller update that is past its cadence", () => {
    const actions = buildListingActions(seededContext(), { ownerOnly: false });
    const lothian = actions.filter((a) => a.listingId === ID.lothianListing);
    expect(lothian.some((a) => a.action.toLowerCase().includes("seller update"))).toBe(true);
  });

  it("flags a coming-soon listing with no copy written before launch", () => {
    const actions = buildListingActions(seededContext(), { ownerOnly: false });
    const brackenridge = actions.filter((a) => a.listingId === ID.brackenridgeListing);
    expect(brackenridge.some((a) => a.marketingAssetKind === "coming_soon_post")).toBe(true);
  });

  it("flags a price change nobody announced", () => {
    const actions = buildListingActions(seededContext(), { ownerOnly: false });
    const american = actions.filter((a) => a.listingId === ID.americanListing);
    expect(american.some((a) => a.marketingAssetKind === "price_adjustment_post")).toBe(true);
  });

  it("raises a price conversation when showings keep saying the same thing", () => {
    const actions = buildListingActions(seededContext(), { ownerOnly: false });
    expect(
      actions.some((a) => a.listingId === ID.lothianListing && a.action.toLowerCase().includes("price feedback")),
    ).toBe(true);
  });

  it("does not invent work for a closed listing", () => {
    const ctx = seededContext();
    ctx.dataset.listings = ctx.dataset.listings.map((l) => ({ ...l, status: "closed" as const }));
    expect(buildListingActions(ctx, { ownerOnly: false })).toHaveLength(0);
  });
});
