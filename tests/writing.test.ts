import { describe, expect, it } from "vitest";
import { BANNED_PHRASES, findBannedPhrases, findProhibited, WRITING_GUIDELINES } from "@/lib/ai/prompts/writing";
import { MARKETING_TEMPLATES } from "@/lib/ai/prompts/marketing";
import { MARKETING_KIND_LABELS, type MarketingAssetKind } from "@/lib/types";

describe("writing guidelines", () => {
  it("catches the stock real-estate phrases", () => {
    const found = findBannedPhrases("This stunning home boasts a chef's kitchen nestled in the hills.");
    expect(found).toEqual(expect.arrayContaining(["stunning", "boasts", "nestled", "chef's kitchen"]));
  });

  it("is case insensitive", () => {
    expect(findBannedPhrases("A STUNNING property")).toContain("stunning");
  });

  it("passes copy written in the house style", () => {
    const good =
      "Four bedrooms on a lot that backs to the 11th fairway. The primary is down. The roof is a Class 4 from 2024.";
    expect(findBannedPhrases(good)).toEqual([]);
  });

  it("also enforces the seller's own prohibited phrases", () => {
    const found = findProhibited("Motivated seller, recently reduced.", ["motivated seller", "reduced"]);
    expect(found).toEqual(expect.arrayContaining(["motivated seller", "reduced"]));
  });

  it("returns each phrase once even when a listing repeats a global ban", () => {
    const found = findProhibited("This stunning home.", ["stunning"]);
    expect(found.filter((p) => p === "stunning")).toHaveLength(1);
  });

  it("ships the banned list to the model in the system prompt", () => {
    for (const phrase of BANNED_PHRASES.slice(0, 8)) {
      expect(WRITING_GUIDELINES).toContain(phrase);
    }
  });
});

describe("marketing templates", () => {
  it("defines every content type the UI offers", () => {
    for (const kind of Object.keys(MARKETING_KIND_LABELS) as MarketingAssetKind[]) {
      expect(MARKETING_TEMPLATES[kind], `missing template for ${kind}`).toBeDefined();
      expect(MARKETING_TEMPLATES[kind].kind).toBe(kind);
      expect(MARKETING_TEMPLATES[kind].brief.length).toBeGreaterThan(40);
    }
  });

  it("gives every content type a deterministic fallback, so no key is required", () => {
    for (const template of Object.values(MARKETING_TEMPLATES)) {
      expect(typeof template.fallback).toBe("function");
    }
  });
});
