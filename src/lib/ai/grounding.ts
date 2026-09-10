import type { Evidence, SourceReference, UUID } from "@/lib/types";

/**
 * Evidence grounding.
 *
 * The rule for this system is that the AI may phrase a recommendation but may
 * never invent the facts behind it. Enforcement is structural rather than
 * hopeful: a workflow declares the exact set of records it read, and anything
 * citing a record outside that set is dropped before it reaches the UI.
 */

export class EvidenceLedger {
  private allowed = new Map<string, { recordType: Evidence["recordType"]; recordId: UUID; label: string }>();

  private static key(recordType: string, recordId: string) {
    return `${recordType}:${recordId}`;
  }

  /** Register a record that a workflow actually read. */
  allow(recordType: Evidence["recordType"], recordId: UUID, label: string) {
    this.allowed.set(EvidenceLedger.key(recordType, recordId), { recordType, recordId, label });
    return this;
  }

  allowMany(recordType: Evidence["recordType"], records: { id: UUID }[], label: (r: { id: UUID }) => string) {
    for (const record of records) this.allow(recordType, record.id, label(record));
    return this;
  }

  has(recordType: string, recordId: string) {
    return this.allowed.has(EvidenceLedger.key(recordType, recordId));
  }

  /** Everything the workflow was allowed to see, for the `ai_runs` audit row. */
  inputRecordIds() {
    return [...this.allowed.values()].map(({ recordType, recordId }) => ({ recordType, recordId }));
  }

  size() {
    return this.allowed.size;
  }

  /**
   * Drop any evidence item that points at a record this workflow did not read.
   * Returns the surviving items — never throws, because a partially grounded
   * recommendation is still useful; a fabricated one is not.
   */
  filter(evidence: Evidence[]): Evidence[] {
    return evidence.filter((e) => this.has(e.recordType, e.recordId));
  }

  /** Which items were rejected — surfaced as a warning so it is never silent. */
  rejected(evidence: Evidence[]): Evidence[] {
    return evidence.filter((e) => !this.has(e.recordType, e.recordId));
  }

  toSourceReferences(evidence: Evidence[]): SourceReference[] {
    return this.filter(evidence).map((e) => ({
      recordType: e.recordType,
      recordId: e.recordId,
      label: this.allowed.get(EvidenceLedger.key(e.recordType, e.recordId))?.label ?? e.label,
    }));
  }
}

/**
 * Convenience for the common case: filter a list of evidence against a ledger
 * and report how many items were rejected.
 */
export function groundEvidence(ledger: EvidenceLedger, evidence: Evidence[]) {
  const kept = ledger.filter(evidence);
  const dropped = ledger.rejected(evidence);
  return { evidence: kept, droppedCount: dropped.length, dropped };
}
