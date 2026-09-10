/**
 * Email adapter interface.
 *
 * Intentionally narrow. The product needs to read threads, spot messages nobody
 * answered, classify inbound inquiries, and stage a draft — nothing more. That
 * narrowness is what lets a Google OAuth client, a Zapier relay, or an MCP
 * server all satisfy the same contract.
 *
 * Drafting *creates a draft*. Nothing in this product sends mail.
 */

export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  subject: string;
  snippet: string;
  body?: string | null;
  receivedAt: string;
  direction: "inbound" | "outbound";
  labels: string[];
}

export interface EmailThread {
  id: string;
  subject: string;
  participants: string[];
  messages: EmailMessage[];
  lastMessageAt: string;
  awaitingReply: boolean;
}

export interface EmailSearchCriteria {
  query?: string;
  contactEmail?: string;
  since?: string;
  awaitingReplyOnly?: boolean;
  limit?: number;
}

export interface InboundClassification {
  isInquiry: boolean;
  confidence: number;
  reason: string;
}

export interface EmailAdapter {
  readonly mode: "mock" | "live";
  searchEmails(criteria: EmailSearchCriteria): Promise<EmailMessage[]>;
  getThread(threadId: string): Promise<EmailThread | null>;
  /** Inbound messages with no outbound reply after them. */
  findUnanswered(opts?: { olderThanHours?: number; limit?: number }): Promise<EmailMessage[]>;
  /** Creates a draft. Never sends. */
  draftEmail(input: {
    to: string;
    subject: string;
    body: string;
    threadId?: string;
  }): Promise<{ draftId: string; created: boolean; note?: string }>;
  classifyInbound(message: Pick<EmailMessage, "subject" | "snippet" | "body">): Promise<InboundClassification>;
}
