/**
 * Cloze adapter interface.
 *
 * Cloze stays the CRM system of record. The Residential OS reads from it,
 * writes tasks and notes back to it, and caches what it needs to score — it
 * does not attempt to replace it.
 */

export interface ClozeContact {
  id: string;
  firstName: string;
  lastName: string;
  emails: string[];
  phones: string[];
  stage?: string | null;
  segments: string[];
  lastContactAt?: string | null;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  city?: string | null;
  notes?: string | null;
}

export interface ClozeHistoryEntry {
  id: string;
  contactId: string;
  type: "email" | "call" | "meeting" | "note" | "text";
  direction: "inbound" | "outbound" | "none";
  occurredAt: string;
  subject?: string | null;
  snippet?: string | null;
}

export interface ClozeTask {
  id: string;
  contactId?: string | null;
  title: string;
  dueAt: string;
  completed: boolean;
}

export interface ClozeDeal {
  id: string;
  name: string;
  stage: string;
  value?: number | null;
  contactIds: string[];
  closeDate?: string | null;
}

export interface ClozeNote {
  id: string;
  contactId: string;
  body: string;
  createdAt: string;
}

export interface ClozeAdapter {
  readonly mode: "mock" | "live";
  searchContacts(query: string, limit?: number): Promise<ClozeContact[]>;
  getContact(id: string): Promise<ClozeContact | null>;
  getContactHistory(id: string, limit?: number): Promise<ClozeHistoryEntry[]>;
  getTasks(opts?: { openOnly?: boolean }): Promise<ClozeTask[]>;
  createTask(task: { title: string; dueAt: string; contactId?: string }): Promise<ClozeTask>;
  getDeals(): Promise<ClozeDeal[]>;
  getNotes(contactId: string): Promise<ClozeNote[]>;
  createNote(note: { contactId: string; body: string }): Promise<ClozeNote>;
  /**
   * Cloze has no documented public endpoint for composing a draft in the user's
   * mailbox. Where it is unsupported this returns `{ supported: false }` and the
   * caller falls back to the Gmail adapter, which is the correct place for it.
   */
  draftEmailIfSupported(input: {
    contactId: string;
    subject: string;
    body: string;
  }): Promise<{ supported: false; reason: string } | { supported: true; draftId: string }>;
}
