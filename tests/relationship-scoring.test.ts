import { describe, expect, it } from "vitest";
import { scoreAllRelationships, scoreRelationship } from "@/lib/scoring/relationship";
import { daysBeforeNow } from "@/lib/utils";
import { ID, seededContext } from "./helpers";

describe("relationship scoring", () => {
  it("surfaces the sphere contact who reads everything but never talks to anyone", () => {
    // David Collins: four market-email opens, two property clicks, no personal
    // contact in seven months. This is the example the product is built around.
    const ctx = seededContext();
    const collins = ctx.contactById.get(ID.collins)!;
    const score = scoreRelationship(collins, ctx);

    expect(score).not.toBeNull();
    expect(score!.score).toBeGreaterThan(45);
    const keys = score!.signals.map((s) => s.key);
    expect(keys).toContain("engagement");
    expect(keys).toContain("property_click");
    expect(keys).toContain("lapse");
  });

  it("weights a lapse against the relationship type, not the raw day count", () => {
    const ctx = seededContext();
    // A sphere contact and an active buyer, both 16 days since a real
    // conversation. The buyer is a problem; the sphere contact is not.
    const buyer = { ...ctx.contactById.get(ID.pryor)!, lastPersonalContactAt: daysBeforeNow(16) };
    const sphere = { ...ctx.contactById.get(ID.mendes)!, lastPersonalContactAt: daysBeforeNow(16) };

    const buyerLapse = scoreRelationship(buyer, ctx)!.signals.find((s) => s.key === "lapse");
    const sphereLapse = scoreRelationship(sphere, ctx)!.signals.find((s) => s.key === "lapse");

    expect(buyerLapse).toBeDefined();
    expect(sphereLapse).toBeUndefined();
  });

  it("does not grow without bound as a lapse gets older", () => {
    const ctx = seededContext();
    const base = ctx.contactById.get(ID.collins)!;
    const oneYear = scoreRelationship({ ...base, lastPersonalContactAt: daysBeforeNow(365) }, ctx)!;
    const tenYears = scoreRelationship({ ...base, lastPersonalContactAt: daysBeforeNow(3650) }, ctx)!;
    const lapseOf = (s: typeof oneYear) => s.signals.find((x) => x.key === "lapse")!.points;

    // Ten years stale is worse than one, but not ten times worse — otherwise a
    // long-dead contact permanently outranks a client waiting today.
    expect(lapseOf(tenYears)).toBeGreaterThanOrEqual(lapseOf(oneYear));
    expect(lapseOf(tenYears)).toBeLessThan(lapseOf(oneYear) * 2);
  });

  it("fires when a stated plan comes due", () => {
    // John Smith said in the spring he would revisit moving once school started.
    const ctx = seededContext();
    const smith = ctx.contactById.get(ID.smith)!;
    const score = scoreRelationship(smith, ctx)!;
    expect(score.signals.some((s) => s.key.startsWith("plan:"))).toBe(true);
    expect(score.whyNow.toLowerCase()).toContain("they told you");
  });

  it("quotes a stated plan verbatim rather than paraphrasing it", () => {
    const ctx = seededContext();
    const dunbar = ctx.contactById.get(ID.dunbar)!;
    const score = scoreRelationship(dunbar, ctx)!;
    const planSignal = score.signals.find((s) => s.key.startsWith("plan:"))!;
    expect(planSignal.clause).toContain(dunbar.statedPlans[0].statement.replace(/\.$/, ""));
  });

  it("treats an unanswered inbound email as the most urgent kind of signal", () => {
    const ctx = seededContext();
    const dunbar = scoreRelationship(ctx.contactById.get(ID.dunbar)!, ctx)!;
    const unanswered = dunbar.signals.find((s) => s.key === "unanswered")!;
    expect(unanswered).toBeDefined();
    expect(dunbar.recommendedChannel).toBe("email");
    expect(dunbar.recommendedAction).toMatch(/reply/i);
  });

  it("stays silent about contacts with nothing outstanding", () => {
    const ctx = seededContext();
    const current = {
      ...ctx.contactById.get(ID.kim)!,
      lastPersonalContactAt: daysBeforeNow(0),
      statedPlans: [],
    };
    // Clear the derived signals that would otherwise fire for an active buyer.
    ctx.emailEventsByContactId.delete(current.id);
    ctx.buyerByContactId.delete(current.id);
    expect(scoreRelationship(current, ctx)).toBeNull();
  });

  it("never scores a do-not-contact record", () => {
    const ctx = seededContext();
    const contact = { ...ctx.contactById.get(ID.collins)!, doNotContact: true };
    expect(scoreRelationship(contact, ctx)).toBeNull();
  });

  it("raises confidence only when independent signals agree", () => {
    const ctx = seededContext();
    const scores = scoreAllRelationships(ctx);
    for (const score of scores) {
      expect(score.confidence).toBeLessThanOrEqual(0.95);
      if (score.signals.length === 1) expect(score.confidence).toBeLessThan(0.6);
      if (score.signals.length >= 4) expect(score.confidence).toBeGreaterThan(0.85);
    }
  });

  it("returns results ordered by score", () => {
    const scores = scoreAllRelationships(seededContext());
    expect(scores.length).toBeGreaterThan(3);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1].score).toBeGreaterThanOrEqual(scores[i].score);
    }
  });

  it("attaches a real record id to every signal it fires", () => {
    for (const score of scoreAllRelationships(seededContext())) {
      for (const signal of score.signals) {
        expect(signal.evidence.recordId).toMatch(/^[0-9a-f-]{20,}$/i);
        expect(signal.evidence.detail.length).toBeGreaterThan(0);
      }
    }
  });
});
