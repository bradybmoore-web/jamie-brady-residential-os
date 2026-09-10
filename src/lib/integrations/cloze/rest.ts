import "server-only";
import { env } from "@/lib/env";
import type {
  ClozeAdapter,
  ClozeContact,
  ClozeDeal,
  ClozeHistoryEntry,
  ClozeNote,
  ClozeTask,
} from "./types";

/**
 * Live Cloze adapter.
 *
 * Cloze's API is account-gated, so the exact response shapes below could not be
 * verified against a live tenant during development. Every response passes
 * through a narrow normaliser rather than being trusted structurally, so a field
 * that turns out to be named differently degrades to null instead of crashing a
 * page. Adjust the normalisers, not the callers, once a real key is available.
 *
 * TODO(credentials): validate against a live Cloze account and pin the response
 * shapes. See README → "Connecting Cloze".
 */
export class RestClozeAdapter implements ClozeAdapter {
  readonly mode = "live" as const;

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!env.clozeApiKey) throw new Error("CLOZE_API_KEY is not set");
    const url = `${env.clozeApiUrl.replace(/\/$/, "")}${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.clozeApiKey}`,
        ...(env.clozeUserEmail ? { "X-Cloze-User": env.clozeUserEmail } : {}),
        ...init?.headers,
      },
      // CRM data changes constantly; never serve it from a build-time cache.
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Cloze ${init?.method ?? "GET"} ${path} failed: ${response.status} ${body.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  async searchContacts(query: string, limit = 20): Promise<ClozeContact[]> {
    const data = await this.request<{ people?: unknown[] }>(
      `/people/find?query=${encodeURIComponent(query)}&limit=${limit}`,
    );
    return (data.people ?? []).map(normaliseContact);
  }

  async getContact(id: string): Promise<ClozeContact | null> {
    try {
      const data = await this.request<{ person?: unknown }>(`/people/get?uniqueid=${encodeURIComponent(id)}`);
      return data.person ? normaliseContact(data.person) : null;
    } catch {
      return null;
    }
  }

  async getContactHistory(id: string, limit = 25): Promise<ClozeHistoryEntry[]> {
    const data = await this.request<{ history?: unknown[] }>(
      `/people/history?uniqueid=${encodeURIComponent(id)}&limit=${limit}`,
    );
    return (data.history ?? []).map((entry) => normaliseHistory(entry, id));
  }

  async getTasks(opts?: { openOnly?: boolean }): Promise<ClozeTask[]> {
    const data = await this.request<{ tasks?: unknown[] }>(
      `/tasks/list${opts?.openOnly ? "?status=open" : ""}`,
    );
    return (data.tasks ?? []).map(normaliseTask);
  }

  async createTask(task: { title: string; dueAt: string; contactId?: string }): Promise<ClozeTask> {
    const data = await this.request<{ task?: unknown }>("/tasks/create", {
      method: "POST",
      body: JSON.stringify({ name: task.title, dueDate: task.dueAt, personId: task.contactId }),
    });
    return normaliseTask(data.task ?? {});
  }

  async getDeals(): Promise<ClozeDeal[]> {
    const data = await this.request<{ projects?: unknown[] }>("/projects/list");
    return (data.projects ?? []).map(normaliseDeal);
  }

  async getNotes(contactId: string): Promise<ClozeNote[]> {
    const data = await this.request<{ notes?: unknown[] }>(
      `/notes/list?uniqueid=${encodeURIComponent(contactId)}`,
    );
    return (data.notes ?? []).map((n) => normaliseNote(n, contactId));
  }

  async createNote(note: { contactId: string; body: string }): Promise<ClozeNote> {
    const data = await this.request<{ note?: unknown }>("/notes/create", {
      method: "POST",
      body: JSON.stringify({ personId: note.contactId, content: note.body }),
    });
    return normaliseNote(data.note ?? {}, note.contactId);
  }

  async draftEmailIfSupported() {
    // Cloze does not document an endpoint that writes a draft into the user's
    // mailbox. Gmail is the right place for that, so we say so rather than
    // pretending.
    return {
      supported: false as const,
      reason: "Cloze does not expose mailbox drafting. Use the Gmail adapter, which creates a real Gmail draft.",
    };
  }
}

/* ------------------------------------------------------------ normalisers */

type Rec = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function normaliseContact(raw: unknown): ClozeContact {
  const r = (raw ?? {}) as Rec;
  const emails = arr(r.emails)
    .map((e) => (typeof e === "string" ? e : str((e as Rec)?.value)))
    .filter((e): e is string => Boolean(e));
  const phones = arr(r.phones)
    .map((p) => (typeof p === "string" ? p : str((p as Rec)?.value)))
    .filter((p): p is string => Boolean(p));
  const name = str(r.name) ?? "";
  const [first, ...rest] = name.split(" ");
  return {
    id: str(r.uniqueid) ?? str(r.id) ?? "",
    firstName: str(r.firstName) ?? first ?? "",
    lastName: str(r.lastName) ?? rest.join(" "),
    emails,
    phones,
    stage: str(r.stage),
    segments: arr(r.segments).filter((s): s is string => typeof s === "string"),
    lastContactAt: str(r.lastContactDate),
    lastInboundAt: str(r.lastInboundDate),
    lastOutboundAt: str(r.lastOutboundDate),
    city: str(r.city),
    notes: str(r.note),
  };
}

function normaliseHistory(raw: unknown, contactId: string): ClozeHistoryEntry {
  const r = (raw ?? {}) as Rec;
  const rawType = str(r.type) ?? "note";
  const type: ClozeHistoryEntry["type"] = ["email", "call", "meeting", "note", "text"].includes(rawType)
    ? (rawType as ClozeHistoryEntry["type"])
    : "note";
  const direction = str(r.direction);
  return {
    id: str(r.id) ?? crypto.randomUUID(),
    contactId,
    type,
    direction: direction === "inbound" || direction === "outbound" ? direction : "none",
    occurredAt: str(r.date) ?? str(r.occurredAt) ?? new Date().toISOString(),
    subject: str(r.subject),
    snippet: str(r.snippet) ?? str(r.content),
  };
}

function normaliseTask(raw: unknown): ClozeTask {
  const r = (raw ?? {}) as Rec;
  return {
    id: str(r.id) ?? crypto.randomUUID(),
    contactId: str(r.personId),
    title: str(r.name) ?? str(r.title) ?? "Untitled task",
    dueAt: str(r.dueDate) ?? new Date().toISOString(),
    completed: r.completed === true,
  };
}

function normaliseDeal(raw: unknown): ClozeDeal {
  const r = (raw ?? {}) as Rec;
  return {
    id: str(r.id) ?? crypto.randomUUID(),
    name: str(r.name) ?? "Untitled",
    stage: str(r.stage) ?? "unknown",
    value: typeof r.value === "number" ? r.value : null,
    contactIds: arr(r.people).filter((p): p is string => typeof p === "string"),
    closeDate: str(r.closeDate),
  };
}

function normaliseNote(raw: unknown, contactId: string): ClozeNote {
  const r = (raw ?? {}) as Rec;
  return {
    id: str(r.id) ?? crypto.randomUUID(),
    contactId,
    body: str(r.content) ?? str(r.body) ?? "",
    createdAt: str(r.date) ?? new Date().toISOString(),
  };
}
