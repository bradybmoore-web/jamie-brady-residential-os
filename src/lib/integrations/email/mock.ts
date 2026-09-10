import { randomUUID } from "node:crypto";
import { getStore } from "@/lib/data/store";
import type {
  EmailAdapter,
  EmailMessage,
  EmailSearchCriteria,
  EmailThread,
  InboundClassification,
} from "./types";

/**
 * Mock mailbox backed by the cached email events in the dataset.
 *
 * The important behaviour to exercise before Google is connected is
 * "which messages has nobody answered" — that feeds directly into the Today
 * page — so the mock models threads and reply state rather than returning a
 * flat list.
 */
export class MockEmailAdapter implements EmailAdapter {
  readonly mode = "mock" as const;

  private async messages(): Promise<EmailMessage[]> {
    const store = await getStore();
    const [events, contacts] = await Promise.all([store.listEmailEvents(), store.listContacts()]);
    const nameByEmail = new Map(contacts.filter((c) => c.email).map((c) => [c.email!, `${c.firstName} ${c.lastName}`]));

    return events
      .filter((e) => e.type === "email_received" || e.type === "email_sent")
      .map((e) => ({
        id: e.id,
        threadId: e.threadId ?? e.id,
        from: e.type === "email_received" ? e.contactEmail : "jamie@moorehomeaustin.com",
        to: e.type === "email_received" ? ["jamie@moorehomeaustin.com"] : [e.contactEmail],
        subject: e.subject ?? "(no subject)",
        snippet: e.snippet ?? "",
        body: e.snippet ?? null,
        receivedAt: e.occurredAt,
        direction: e.type === "email_received" ? ("inbound" as const) : ("outbound" as const),
        labels: [nameByEmail.get(e.contactEmail) ?? "", e.awaitingReply ? "awaiting-reply" : ""].filter(Boolean),
      }))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  async searchEmails(criteria: EmailSearchCriteria): Promise<EmailMessage[]> {
    const all = await this.messages();
    const q = criteria.query?.trim().toLowerCase();
    return all
      .filter((m) => {
        if (criteria.contactEmail && m.from !== criteria.contactEmail && !m.to.includes(criteria.contactEmail)) return false;
        if (criteria.since && m.receivedAt < criteria.since) return false;
        if (criteria.awaitingReplyOnly && !m.labels.includes("awaiting-reply")) return false;
        if (q && !`${m.subject} ${m.snippet} ${m.from} ${m.labels.join(" ")}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .slice(0, criteria.limit ?? 25);
  }

  async getThread(threadId: string): Promise<EmailThread | null> {
    const all = await this.messages();
    const messages = all.filter((m) => m.threadId === threadId).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    if (messages.length === 0) return null;
    const last = messages[messages.length - 1];
    return {
      id: threadId,
      subject: messages[0].subject,
      participants: [...new Set(messages.flatMap((m) => [m.from, ...m.to]))],
      messages,
      lastMessageAt: last.receivedAt,
      awaitingReply: last.direction === "inbound",
    };
  }

  async findUnanswered(opts?: { olderThanHours?: number; limit?: number }): Promise<EmailMessage[]> {
    const all = await this.messages();
    const minHours = opts?.olderThanHours ?? 0;
    const now = new Date();
    return all
      .filter((m) => m.direction === "inbound" && m.labels.includes("awaiting-reply"))
      .filter((m) => (now.getTime() - new Date(m.receivedAt).getTime()) / 3_600_000 >= minHours)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      .slice(0, opts?.limit ?? 20);
  }

  async draftEmail(input: { to: string; subject: string; body: string; threadId?: string }) {
    // Nothing leaves the building in mock mode. The draft lives in the approval
    // queue, which is where it would sit anyway before a human sends it.
    return {
      draftId: randomUUID(),
      created: false,
      note: `Gmail is not connected, so no draft was created in the mailbox. The message to ${input.to} is held in the approval queue.`,
    };
  }

  async classifyInbound(message: {
    subject: string;
    snippet: string;
    body?: string | null;
  }): Promise<InboundClassification> {
    const text = `${message.subject} ${message.snippet} ${message.body ?? ""}`.toLowerCase();
    const inquirySignals = [
      /\b(is (this|it) (still )?available)\b/,
      /\b(schedule|book|set up) a (showing|tour|time)\b/,
      /\bwhat (is|would) (my|our) (home|house) (be )?worth\b/,
      /\b(interested in|inquiring about|saw your listing)\b/,
      /\b(pre-?approved|pre-?qualified)\b/,
      /\bthinking about (selling|buying|moving)\b/,
    ];
    const hits = inquirySignals.filter((r) => r.test(text));
    const isInquiry = hits.length > 0;
    return {
      isInquiry,
      confidence: isInquiry ? Math.min(0.9, 0.55 + hits.length * 0.15) : 0.7,
      reason: isInquiry
        ? `Matched ${hits.length} inquiry pattern${hits.length === 1 ? "" : "s"} in the subject and body.`
        : "No inquiry language detected; treated as ordinary correspondence.",
    };
  }
}
