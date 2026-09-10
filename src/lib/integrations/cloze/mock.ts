import { randomUUID } from "node:crypto";
import { getStore } from "@/lib/data/store";
import { contactName } from "@/lib/types";
import type {
  ClozeAdapter,
  ClozeContact,
  ClozeDeal,
  ClozeHistoryEntry,
  ClozeNote,
  ClozeTask,
} from "./types";

/**
 * Mock Cloze adapter backed by the local cache.
 *
 * It answers with the same shapes the real API does, so the AI tools, the
 * assistant and the workflows all exercise the real code path. When
 * `CLOZE_API_KEY` appears, the REST adapter takes over and nothing above this
 * layer changes.
 */
export class MockClozeAdapter implements ClozeAdapter {
  readonly mode = "mock" as const;

  async searchContacts(query: string, limit = 20): Promise<ClozeContact[]> {
    const store = await getStore();
    const contacts = await store.listContacts();
    const q = query.trim().toLowerCase();
    return contacts
      .filter((c) => {
        if (!q) return true;
        const haystack = [
          contactName(c),
          c.email ?? "",
          c.city ?? "",
          c.neighborhood ?? "",
          ...c.tags,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, limit)
      .map(toClozeContact);
  }

  async getContact(id: string): Promise<ClozeContact | null> {
    const store = await getStore();
    const contact = await store.getContact(id);
    return contact ? toClozeContact(contact) : null;
  }

  async getContactHistory(id: string, limit = 25): Promise<ClozeHistoryEntry[]> {
    const store = await getStore();
    const [contact, events] = await Promise.all([store.getContact(id), store.listEmailEvents()]);
    if (!contact) return [];

    const fromEmail: ClozeHistoryEntry[] = events
      .filter((e) => e.contactId === id)
      .map((e) => ({
        id: e.id,
        contactId: id,
        type: "email" as const,
        direction: e.type === "email_received" ? ("inbound" as const) : ("outbound" as const),
        occurredAt: e.occurredAt,
        subject: e.subject ?? e.campaignName ?? null,
        snippet: e.snippet ?? null,
      }));

    const fromNotes: ClozeHistoryEntry[] = contact.notes.map((n) => ({
      id: n.id,
      contactId: id,
      type: "note" as const,
      direction: "none" as const,
      occurredAt: n.createdAt,
      subject: null,
      snippet: n.body,
    }));

    return [...fromEmail, ...fromNotes]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit);
  }

  async getTasks(opts?: { openOnly?: boolean }): Promise<ClozeTask[]> {
    const store = await getStore();
    const tasks = await store.listTasks();
    return tasks
      .filter((t) => (opts?.openOnly ? t.status === "open" : true))
      .map((t) => ({
        id: t.id,
        contactId: t.contactId ?? null,
        title: t.title,
        dueAt: t.dueAt,
        completed: t.status === "done",
      }));
  }

  async createTask(task: { title: string; dueAt: string; contactId?: string }): Promise<ClozeTask> {
    // The mock records intent locally. The REST adapter writes to Cloze itself.
    return { id: randomUUID(), contactId: task.contactId ?? null, title: task.title, dueAt: task.dueAt, completed: false };
  }

  async getDeals(): Promise<ClozeDeal[]> {
    const store = await getStore();
    const [transactions, properties] = await Promise.all([store.listTransactions(), store.listProperties()]);
    const addressById = new Map(properties.map((p) => [p.id, p.address]));
    return transactions.map((t) => ({
      id: t.id,
      name: addressById.get(t.propertyId) ?? "Transaction",
      stage: t.status,
      value: t.contractPrice,
      contactIds: t.clientContactIds,
      closeDate: t.closeDate,
    }));
  }

  async getNotes(contactId: string): Promise<ClozeNote[]> {
    const store = await getStore();
    const contact = await store.getContact(contactId);
    return (contact?.notes ?? []).map((n) => ({ id: n.id, contactId, body: n.body, createdAt: n.createdAt }));
  }

  async createNote(note: { contactId: string; body: string }): Promise<ClozeNote> {
    const store = await getStore();
    const created = await store.addContactNote({
      contactId: note.contactId,
      authorId: note.contactId,
      body: note.body,
      sourceSystem: "manual",
    });
    return { id: created.id, contactId: note.contactId, body: note.body, createdAt: created.createdAt };
  }

  async draftEmailIfSupported() {
    return {
      supported: false as const,
      reason: "Cloze drafting is not enabled in mock mode. Drafts are stored in the approval queue instead.",
    };
  }
}

function toClozeContact(c: Awaited<ReturnType<Awaited<ReturnType<typeof getStore>>["getContact"]>> & object): ClozeContact {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    emails: c.email ? [c.email] : [],
    phones: c.phone ? [c.phone] : [],
    stage: c.stage,
    segments: c.tags,
    lastContactAt: c.lastTouchAt ?? null,
    lastInboundAt: null,
    lastOutboundAt: c.lastPersonalContactAt ?? null,
    city: c.city ?? null,
    notes: c.notes[0]?.body ?? null,
  };
}
