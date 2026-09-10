import { describe, expect, it } from "vitest";
import { heuristicAnalysis, scoreLead } from "@/lib/workflows/analyze-lead";
import { seededDataset } from "./helpers";
import { ID } from "@/lib/data/ids";
import type { Lead } from "@/lib/types";

function lead(overrides: Partial<Lead> = {}): Lead {
  const dataset = seededDataset();
  const base = dataset.leads.find((l) => l.id === ID.leadReyes)!;
  return { ...base, ...overrides };
}

describe("lead classification (no API key)", () => {
  it("reads a home-value question as a seller even when they also need to buy", () => {
    const analysis = heuristicAnalysis(
      lead({ inquiryContent: "What is our house worth? We would also need to find something bigger." }),
    );
    expect(analysis.type).toBe("seller");
    expect(analysis.intentConfidence).toBeGreaterThan(0.6);
    expect(analysis.reasons.join(" ")).toMatch(/worth|selling/i);
  });

  it("reads a showing request as a buyer", () => {
    const analysis = heuristicAnalysis(
      lead({ inquiryContent: "Can we tour this on Saturday? We are pre-approved to 1.4." }),
    );
    expect(analysis.type).toBe("buyer");
  });

  it("reads rental-income language as an investor", () => {
    const analysis = heuristicAnalysis(
      lead({ inquiryContent: "What are the short-term rental rules? I am looking at cash flow." }),
    );
    expect(analysis.type).toBe("investor");
  });

  it("admits it does not know rather than guessing", () => {
    const analysis = heuristicAnalysis(lead({ inquiryContent: "Is this still available?" }));
    expect(analysis.type).toBe("unknown");
    expect(analysis.intentConfidence).toBeLessThanOrEqual(0.4);
  });

  it("treats a hard deadline as critical and an explicit non-deadline as low", () => {
    expect(heuristicAnalysis(lead({ inquiryContent: "We must be in Houston by the end of the year." })).urgency).toBe(
      "critical",
    );
    expect(
      heuristicAnalysis(lead({ inquiryContent: "Nothing imminent, maybe in a couple of years.", estimatedTimeline: null }))
        .urgency,
    ).toBe("low");
  });

  it("always produces a usable first reply", () => {
    for (const text of [
      "What is my house worth?",
      "Can I see 2700 Lothian?",
      "Is this still available?",
      "What are the POA short-term rental rules?",
    ]) {
      const analysis = heuristicAnalysis(lead({ inquiryContent: text }));
      expect(analysis.suggestedResponse.length).toBeGreaterThan(120);
      expect(analysis.suggestedResponse).toContain("Jamie Moore");
      // The opener we specifically banned.
      expect(analysis.suggestedResponse.toLowerCase()).not.toContain("hope this finds you well");
    }
  });
});

describe("lead scoring", () => {
  it("stays within 0-100 for every seeded lead", () => {
    for (const seeded of seededDataset().leads) {
      const score = scoreLead(seeded, heuristicAnalysis(seeded));
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("ranks a detailed referral above a one-line portal enquiry", () => {
    const referral = lead({
      source: "Referral — Claire Dunbar",
      inquiryContent:
        "Claire gave me your name. We are relocating from Denver in November, looking in 78704 around 1.3 to 1.6, and we need to be settled by the new year.",
      phone: "(512) 555-0100",
    });
    const portal = lead({ source: "Zillow", inquiryContent: "Is this still available?", phone: null });

    expect(scoreLead(referral, heuristicAnalysis(referral))).toBeGreaterThan(
      scoreLead(portal, heuristicAnalysis(portal)) + 25,
    );
  });

  it("lowers the score as attempts pile up without contact", () => {
    const fresh = lead({ attemptCount: 0 });
    const stale = lead({ attemptCount: 3 });
    expect(scoreLead(stale, heuristicAnalysis(stale))).toBeLessThan(scoreLead(fresh, heuristicAnalysis(fresh)));
  });

  it("is deterministic — the same lead always scores the same", () => {
    const subject = lead();
    const analysis = heuristicAnalysis(subject);
    expect(scoreLead(subject, analysis)).toBe(scoreLead(subject, analysis));
  });
});
