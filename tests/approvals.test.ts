import { beforeEach, describe, expect, it } from "vitest";
import { getStore } from "@/lib/data/store";
import { buildSeedDataset } from "@/lib/data/seed";
import { ID } from "@/lib/data/ids";
import { analyzeLead } from "@/lib/workflows/analyze-lead";
import { MockEmailAdapter } from "@/lib/integrations/email/mock";
import { MockClozeAdapter } from "@/lib/integrations/cloze/mock";

const DATASET_KEY = Symbol.for("residential-os.memory-dataset");

beforeEach(() => {
  (globalThis as Record<symbol, unknown>)[DATASET_KEY] = buildSeedDataset();
});

describe("approval guarantees", () => {
  it("marks every outbound draft as requiring approval", async () => {
    const store = await getStore();
    await analyzeLead(ID.leadReyes, ID.jamie);
    await analyzeLead(ID.leadVandenberg, ID.jamie);

    const outbound = (await store.listAIActions()).filter((a) =>
      ["email_draft", "text_draft", "stage_change"].includes(a.type),
    );
    expect(outbound.length).toBeGreaterThan(0);
    for (const action of outbound) {
      expect(action.requiresApproval, action.title).toBe(true);
      expect(action.status).toBe("needs_review");
    }
  });

  it("never records anything as sent without a human step", async () => {
    const store = await getStore();
    await analyzeLead(ID.leadReyes, ID.jamie);
    for (const action of await store.listAIActions()) {
      expect(action.executedAt).toBeUndefined();
      expect(action.status).not.toBe("executed");
    }
  });
});

describe("email adapter", () => {
  const adapter = new MockEmailAdapter();

  it("finds inbound messages nobody has replied to", async () => {
    const unanswered = await adapter.findUnanswered();
    expect(unanswered.length).toBeGreaterThan(0);
    for (const message of unanswered) expect(message.direction).toBe("inbound");
  });

  it("returns oldest first, because that is the one at risk", async () => {
    const unanswered = await adapter.findUnanswered();
    for (let i = 1; i < unanswered.length; i++) {
      expect(unanswered[i - 1].receivedAt <= unanswered[i].receivedAt).toBe(true);
    }
  });

  it("does not create a mailbox draft when Gmail is not connected, and says so", async () => {
    const result = await adapter.draftEmail({ to: "someone@example.com", subject: "Hello", body: "Body" });
    expect(result.created).toBe(false);
    expect(result.note).toMatch(/not connected|approval queue/i);
  });

  it("classifies an inbound inquiry", async () => {
    const inquiry = await adapter.classifyInbound({
      subject: "Your listing",
      snippet: "Is this still available? Can we schedule a showing?",
    });
    expect(inquiry.isInquiry).toBe(true);

    const ordinary = await adapter.classifyInbound({
      subject: "Lunch Thursday",
      snippet: "Are we still on for noon?",
    });
    expect(ordinary.isInquiry).toBe(false);
  });
});

describe("cloze adapter", () => {
  const adapter = new MockClozeAdapter();

  it("searches contacts and returns the Cloze shape", async () => {
    const results = await adapter.searchContacts("Cedar Park");
    expect(results.length).toBeGreaterThan(0);
    for (const contact of results) {
      expect(contact).toHaveProperty("emails");
      expect(contact).toHaveProperty("segments");
      expect(Array.isArray(contact.emails)).toBe(true);
    }
  });

  it("returns a merged history of email and notes, newest first", async () => {
    const history = await adapter.getContactHistory(ID.collins);
    expect(history.length).toBeGreaterThan(0);
    for (let i = 1; i < history.length; i++) {
      expect(history[i - 1].occurredAt >= history[i].occurredAt).toBe(true);
    }
  });

  it("says plainly that it cannot draft mail rather than pretending", async () => {
    const result = await adapter.draftEmailIfSupported();
    expect(result.supported).toBe(false);
  });
});
