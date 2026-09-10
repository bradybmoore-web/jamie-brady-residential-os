import "server-only";
import { getGoogleAccessToken } from "../google-auth";
import type {
  EmailAdapter,
  EmailMessage,
  EmailSearchCriteria,
  EmailThread,
  InboundClassification,
} from "./types";
import { MockEmailAdapter } from "./mock";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Gmail adapter.
 *
 * Scopes required: `gmail.readonly` and `gmail.compose`. Note that
 * `gmail.compose` allows creating drafts — it is deliberately *not*
 * `gmail.send`, so this application cannot send mail even if a future change
 * tried to.
 *
 * TODO(credentials): needs a Google Cloud project with the Gmail API enabled
 * and a refresh token for jamie@. See README → "Connecting Google".
 */
export class GmailAdapter implements EmailAdapter {
  readonly mode = "live" as const;
  /** Classification is local pattern matching; no reason to duplicate it. */
  private classifier = new MockEmailAdapter();

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getGoogleAccessToken();
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Gmail ${init?.method ?? "GET"} ${path} failed: ${response.status} ${body.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  async searchEmails(criteria: EmailSearchCriteria): Promise<EmailMessage[]> {
    const parts: string[] = [];
    if (criteria.query) parts.push(criteria.query);
    if (criteria.contactEmail) parts.push(`from:${criteria.contactEmail} OR to:${criteria.contactEmail}`);
    if (criteria.since) parts.push(`after:${criteria.since.slice(0, 10).replace(/-/g, "/")}`);
    const q = encodeURIComponent(parts.join(" ") || "in:anywhere");

    const list = await this.request<{ messages?: { id: string }[] }>(
      `/messages?q=${q}&maxResults=${criteria.limit ?? 25}`,
    );
    const ids = (list.messages ?? []).map((m) => m.id);
    const messages = await Promise.all(ids.map((id) => this.getMessage(id)));
    const resolved = messages.filter((m): m is EmailMessage => m !== null);
    return criteria.awaitingReplyOnly ? resolved.filter((m) => m.direction === "inbound") : resolved;
  }

  private async getMessage(id: string): Promise<EmailMessage | null> {
    try {
      const raw = await this.request<GmailMessage>(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
      return normaliseMessage(raw);
    } catch {
      return null;
    }
  }

  async getThread(threadId: string): Promise<EmailThread | null> {
    try {
      const raw = await this.request<{ id: string; messages?: GmailMessage[] }>(`/threads/${threadId}?format=metadata`);
      const messages = (raw.messages ?? []).map(normaliseMessage);
      if (messages.length === 0) return null;
      const last = messages[messages.length - 1];
      return {
        id: raw.id,
        subject: messages[0].subject,
        participants: [...new Set(messages.flatMap((m) => [m.from, ...m.to]))],
        messages,
        lastMessageAt: last.receivedAt,
        awaitingReply: last.direction === "inbound",
      };
    } catch {
      return null;
    }
  }

  async findUnanswered(opts?: { olderThanHours?: number; limit?: number }): Promise<EmailMessage[]> {
    // Gmail has no "unanswered" operator, so approximate: recent inbox threads
    // whose last message came from someone else.
    const list = await this.request<{ threads?: { id: string }[] }>(
      `/threads?q=${encodeURIComponent("in:inbox -in:chats newer_than:14d")}&maxResults=${opts?.limit ?? 20}`,
    );
    const threads = await Promise.all((list.threads ?? []).map((t) => this.getThread(t.id)));
    const minHours = opts?.olderThanHours ?? 0;
    const now = Date.now();
    return threads
      .filter((t): t is EmailThread => t !== null && t.awaitingReply)
      .map((t) => t.messages[t.messages.length - 1])
      .filter((m) => (now - new Date(m.receivedAt).getTime()) / 3_600_000 >= minHours)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }

  async draftEmail(input: { to: string; subject: string; body: string; threadId?: string }) {
    const mime = [
      `To: ${input.to}`,
      `Subject: ${input.subject}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      input.body,
    ].join("\r\n");
    const raw = Buffer.from(mime).toString("base64url");
    const created = await this.request<{ id: string }>("/drafts", {
      method: "POST",
      body: JSON.stringify({ message: { raw, threadId: input.threadId } }),
    });
    return { draftId: created.id, created: true };
  }

  classifyInbound(message: { subject: string; snippet: string; body?: string | null }): Promise<InboundClassification> {
    return this.classifier.classifyInbound(message);
  }
}

interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

function normaliseMessage(raw: GmailMessage): EmailMessage {
  const headers = new Map((raw.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  const labels = raw.labelIds ?? [];
  return {
    id: raw.id,
    threadId: raw.threadId,
    from: headers.get("from") ?? "",
    to: (headers.get("to") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    subject: headers.get("subject") ?? "(no subject)",
    snippet: raw.snippet ?? "",
    body: null,
    receivedAt: raw.internalDate
      ? new Date(Number(raw.internalDate)).toISOString()
      : (headers.get("date") ? new Date(headers.get("date")!).toISOString() : new Date().toISOString()),
    direction: labels.includes("SENT") ? "outbound" : "inbound",
    labels,
  };
}
