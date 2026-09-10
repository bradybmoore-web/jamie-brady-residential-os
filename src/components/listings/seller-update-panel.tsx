"use client";

import { useState, useTransition } from "react";
import { FileText, RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Textarea,
} from "@/components/ui/primitives";
import {
  approveSellerUpdateAction,
  generateSellerUpdateAction,
  rejectSellerUpdateAction,
} from "@/app/actions/listings";
import { APPROVAL_STATUS_LABELS, type SellerUpdate } from "@/lib/types";
import { formatDate } from "@/lib/utils";

/**
 * The seller update review surface.
 *
 * The three sections are kept visually distinct on purpose: sellers make
 * expensive decisions from these, and they need to see which sentences are
 * measurements and which are Jamie's reading of them.
 */
export function SellerUpdatePanel({
  listingId,
  updates: initialUpdates,
  mlsIsMock,
}: {
  listingId: string;
  updates: SellerUpdate[];
  mlsIsMock: boolean;
}) {
  const [updates, setUpdates] = useState(initialUpdates);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const generate = () => {
    startTransition(async () => {
      const result = await generateSellerUpdateAction(listingId);
      if (result.ok && result.data) {
        setUpdates((prev) => [result.data!.update, ...prev]);
        setMessage(result.message ?? null);
      } else if (!result.ok) {
        setMessage(result.error);
      }
    });
  };

  const latest = updates[0];

  return (
    <Card id="seller-updates">
      <CardHeader>
        <div>
          <CardTitle>Seller Updates</CardTitle>
          <p className="mt-0.5 text-[12px] text-ink-faint">
            Facts are measured. Interpretation and recommendation are opinions, and are labelled as such.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={generate} disabled={pending}>
          <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden />
          {pending ? "Building…" : "Generate update"}
        </Button>
      </CardHeader>

      <CardContent>
        {message ? <p className="mb-3 text-[12.5px] text-brass">{message}</p> : null}

        {mlsIsMock ? (
          <p className="mb-4 rounded-[4px] border border-line bg-warn-soft/50 px-3 py-2 text-[12px] leading-relaxed text-warn">
            MLS is not connected. Competing actives, pendings and sales come from a local mock feed, not licensed
            data. Do not send these figures to a seller until Unlock MLS is connected.
          </p>
        ) : null}

        {!latest ? (
          <EmptyState
            title="No update drafted yet"
            description="Generate one and it will pull this week's showings, feedback, engagement and the competitive set."
          />
        ) : (
          <UpdateView key={latest.id} update={latest} />
        )}

        {updates.length > 1 ? (
          <details className="mt-5 border-t border-line pt-3">
            <summary className="cursor-pointer text-[12.5px] text-ink-muted hover:text-ink">
              {updates.length - 1} earlier update{updates.length === 2 ? "" : "s"}
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              {updates.slice(1).map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="text-ink-muted">
                    {formatDate(u.periodStart)} – {formatDate(u.periodEnd)}
                  </span>
                  <Badge tone={u.status === "approved" || u.status === "executed" ? "good" : "neutral"}>
                    {APPROVAL_STATUS_LABELS[u.status]}
                  </Badge>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function UpdateView({ update }: { update: SellerUpdate }) {
  const [draft, setDraft] = useState(update.draftMessage);
  const [status, setStatus] = useState(update.status);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const approve = () => {
    startTransition(async () => {
      const result = await approveSellerUpdateAction({ updateId: update.id, draftMessage: draft });
      if (result.ok) {
        setStatus("approved");
        setMessage(result.message ?? null);
      } else {
        setMessage(result.error);
      }
    });
  };

  const reject = () => {
    startTransition(async () => {
      const result = await rejectSellerUpdateAction(update.id);
      if (result.ok) setStatus("rejected");
      setMessage(result.ok ? (result.message ?? null) : result.error);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status === "approved" || status === "executed" ? "good" : status === "rejected" ? "neutral" : "warn"}>
          {APPROVAL_STATUS_LABELS[status]}
        </Badge>
        <span className="text-[12px] text-ink-faint">
          {formatDate(update.periodStart)} – {formatDate(update.periodEnd)}
        </span>
        <span className="text-[12px] text-ink-faint">· {update.marketContext.daysOnMarket} days on market</span>
      </div>

      <section>
        <div className="eyebrow text-ink">Facts</div>
        <p className="mt-0.5 text-[11px] text-ink-faint">Measured from the record. Not written by the model.</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {update.facts.map((fact, i) => (
            <li key={i} className="tabular text-[13px] leading-relaxed text-ink">
              {fact}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-[4px] border border-line bg-surface-sunk/50 px-4 py-3">
        <div className="eyebrow">Market interpretation</div>
        <p className="mt-0.5 text-[11px] text-ink-faint">A reading of the facts above. Not itself a fact.</p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink">{update.marketInterpretation}</p>
      </section>

      <section className="rounded-[4px] border border-brass/30 bg-brass-soft/40 px-4 py-3">
        <div className="eyebrow text-brass">Recommended action</div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink">{update.recommendedAction}</p>
      </section>

      <section>
        <div className="flex items-center gap-1.5">
          <FileText className="size-3.5 text-ink-faint" strokeWidth={1.75} aria-hidden />
          <span className="eyebrow">Draft message to the sellers</span>
        </div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={14}
          className="mt-2 font-sans"
          aria-label="Draft seller message"
          disabled={status === "approved" || status === "executed"}
        />
      </section>

      {message ? <p className="text-[12.5px] text-brass">{message}</p> : null}

      {status === "needs_review" || status === "draft" ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={approve} disabled={pending}>
            {pending ? "Saving…" : "Approve"}
          </Button>
          <Button variant="ghost" size="sm" onClick={reject} disabled={pending}>
            Reject
          </Button>
        </div>
      ) : (
        <p className="text-[12.5px] text-ink-muted">
          {status === "approved"
            ? "Approved. Copy the message above and send it from your mail client."
            : "This update was rejected. Generate a new one when you are ready."}
        </p>
      )}
    </div>
  );
}
