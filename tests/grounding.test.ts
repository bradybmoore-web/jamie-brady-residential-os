import { describe, expect, it } from "vitest";
import { EvidenceLedger, groundEvidence } from "@/lib/ai/grounding";
import type { Evidence } from "@/lib/types";

const REAL_ID = "11111111-0000-4000-8000-000000000001";
const FAKE_ID = "99999999-0000-4000-8000-000000000999";

function evidence(recordId: string, recordType: Evidence["recordType"] = "contact"): Evidence {
  return { label: "Test", detail: "detail", recordType, recordId };
}

describe("EvidenceLedger", () => {
  it("keeps evidence pointing at records the workflow actually read", () => {
    const ledger = new EvidenceLedger().allow("contact", REAL_ID, "Contact");
    expect(ledger.filter([evidence(REAL_ID)])).toHaveLength(1);
  });

  it("drops evidence citing a record the workflow never saw", () => {
    const ledger = new EvidenceLedger().allow("contact", REAL_ID, "Contact");
    const { evidence: kept, droppedCount } = groundEvidence(ledger, [evidence(REAL_ID), evidence(FAKE_ID)]);
    expect(kept).toHaveLength(1);
    expect(kept[0].recordId).toBe(REAL_ID);
    expect(droppedCount).toBe(1);
  });

  it("treats record type as part of the identity", () => {
    // The same UUID under a different record type is a different claim, and
    // must not be waved through.
    const ledger = new EvidenceLedger().allow("contact", REAL_ID, "Contact");
    expect(ledger.filter([evidence(REAL_ID, "listing")])).toHaveLength(0);
  });

  it("reports every record it was allowed to read for the audit row", () => {
    const ledger = new EvidenceLedger()
      .allow("contact", REAL_ID, "Contact")
      .allow("lead", FAKE_ID, "Lead");
    expect(ledger.inputRecordIds()).toEqual([
      { recordType: "contact", recordId: REAL_ID },
      { recordType: "lead", recordId: FAKE_ID },
    ]);
  });

  it("does not double-count a record allowed twice", () => {
    const ledger = new EvidenceLedger().allow("contact", REAL_ID, "A").allow("contact", REAL_ID, "B");
    expect(ledger.size()).toBe(1);
  });

  it("labels source references from the ledger, not from model-supplied text", () => {
    const ledger = new EvidenceLedger().allow("contact", REAL_ID, "Canonical label");
    const refs = ledger.toSourceReferences([{ ...evidence(REAL_ID), label: "Label the model made up" }]);
    expect(refs[0].label).toBe("Canonical label");
  });
});
