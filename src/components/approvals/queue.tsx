"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Send, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Textarea,
} from "@/components/ui/primitives";
import { ConfidenceMeter } from "@/components/ui/confidence";
import {
  approveActionItem,
  editActionItem,
  executeActionItem,
  rejectActionItem,
} from "@/app/actions/approvals";
import { APPROVAL_STATUS_LABELS, type AIAction } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const TYPE_LABELS: Record<AIAction["type"], string> = {
  email_draft: "Email",
  text_draft: "Text message",
  task_suggestion: "Task",
  marketing_content: "Marketing",
  seller_update: "Seller update",
  stage_change: "CRM stage change",
  note: "Note",
};

export function ApprovalQueue({ items }: { items: AIAction[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Nothing waiting on you"
          description="Drafts appear here when the system writes something outbound. Nothing is ever sent without your approval."
        />
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <ApprovalCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function ApprovalCard({ item }: { item: AIAction }) {
  const [status, setStatus] = useState(item.status);
  const [subject, setSubject] = useState(item.subject ?? "");
  const [body, setBody] = useState(item.body);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, next?: AIAction["status"]) => {
    startTransition(async () => {
      const result = await fn();
      setMessage(result.ok ? (result.message ?? "Done.") : (result.error ?? "Something went wrong."));
      if (result.ok && next) setStatus(next);
      if (result.ok) setEditing(false);
    });
  };

  const done = status === "executed" || status === "rejected";

  return (
    <Card className={done ? "opacity-70" : undefined}>
      <CardHeader>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{item.title}</CardTitle>
            <Badge tone="outline">{TYPE_LABELS[item.type]}</Badge>
            <Badge
              tone={
                status === "executed"
                  ? "good"
                  : status === "approved"
                    ? "info"
                    : status === "rejected"
                      ? "neutral"
                      : "warn"
              }
            >
              {APPROVAL_STATUS_LABELS[status]}
            </Badge>
          </div>
          <p className="mt-1 text-[11.5px] text-ink-faint">
            {item.workflow.replace(/_/g, " ")} · {formatDate(item.createdAt)}
            {item.recipient ? ` · to ${item.recipient}` : ""}
          </p>
        </div>
        <ConfidenceMeter value={item.confidence} />
      </CardHeader>

      <CardContent>
        {item.evidence.length > 0 ? (
          <ul className="mb-3 flex flex-col gap-1 border-l border-line pl-3">
            {item.evidence.map((e, i) => (
              <li key={i} className="text-[12px] leading-relaxed">
                <span className="font-medium text-ink">{e.label}:</span>{" "}
                <span className="text-ink-muted">{e.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {editing ? (
          <div className="flex flex-col gap-2.5">
            {item.type === "email_draft" ? (
              <div>
                <label htmlFor={`subject-${item.id}`} className="eyebrow mb-1.5 block">
                  Subject
                </label>
                <Input id={`subject-${item.id}`} value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
            ) : null}
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              aria-label="Message body"
              className="font-sans"
            />
          </div>
        ) : (
          <div className="rounded-[4px] border border-line bg-surface-sunk/50 px-4 py-3">
            {item.subject ? (
              <p className="mb-2 border-b border-line pb-2 text-[13px] font-medium text-ink">{subject}</p>
            ) : null}
            <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink">{body}</pre>
          </div>
        )}

        {message ? <p className="mt-3 text-[12.5px] text-brass">{message}</p> : null}

        {!done ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={() => run(() => editActionItem({ actionId: item.id, subject, body }), "needs_review")}
                >
                  Save changes
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                {status === "needs_review" || status === "draft" ? (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={pending}
                    onClick={() => run(() => approveActionItem(item.id), "approved")}
                  >
                    <Check className="size-3.5" strokeWidth={2} aria-hidden />
                    Approve
                  </Button>
                ) : null}
                {status === "approved" ? (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={pending}
                    onClick={() => run(() => executeActionItem(item.id), "executed")}
                  >
                    <Send className="size-3.5" strokeWidth={1.75} aria-hidden />
                    Send
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => rejectActionItem(item.id), "rejected")}
                >
                  <X className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Reject
                </Button>
              </>
            )}
            {item.leadId ? (
              <Link
                href={`/leads/${item.leadId}`}
                className="ml-auto self-center text-[12px] text-brass hover:underline"
              >
                Open lead
              </Link>
            ) : item.contactId ? (
              <Link
                href={`/clients/${item.contactId}`}
                className="ml-auto self-center text-[12px] text-brass hover:underline"
              >
                Open contact
              </Link>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
