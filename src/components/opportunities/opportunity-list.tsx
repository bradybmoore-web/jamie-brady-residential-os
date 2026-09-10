"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Clock, RefreshCw, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Select,
  UrgencyDot,
  buttonClasses,
} from "@/components/ui/primitives";
import { ConfidenceMeter } from "@/components/ui/confidence";
import {
  dismissOpportunityAction,
  markOpportunityActedAction,
  refreshOpportunitiesAction,
  snoozeOpportunityAction,
} from "@/app/actions/opportunities";
import { CHANNEL_LABELS, CONTACT_TYPE_LABELS, type Contact, type Opportunity } from "@/lib/types";
import { relativeDays } from "@/lib/utils";

export interface OpportunityRow {
  opportunity: Opportunity;
  contact: Contact | null;
}

type SortKey = "urgency" | "likelihood" | "days_since_contact";
type FilterKey = "all" | "active_buyer" | "active_seller" | "past_client" | "sphere";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "urgency", label: "Urgency" },
  { key: "likelihood", label: "Likelihood" },
  { key: "days_since_contact", label: "Days since contact" },
];

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "active_buyer", label: "Buyers" },
  { key: "active_seller", label: "Sellers" },
  { key: "past_client", label: "Past clients" },
  { key: "sphere", label: "Sphere" },
];

export function OpportunityList({ rows: initialRows }: { rows: OpportunityRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [sort, setSort] = useState<SortKey>("urgency");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const filtered = rows.filter((r) => (filter === "all" ? true : r.contact?.type === filter));
    return [...filtered].sort((a, b) => {
      if (sort === "likelihood") return b.opportunity.confidence - a.opportunity.confidence;
      if (sort === "days_since_contact") {
        const days = (c: Contact | null) =>
          c?.lastPersonalContactAt ? -new Date(c.lastPersonalContactAt).getTime() : Number.POSITIVE_INFINITY;
        return days(a.contact) - days(b.contact);
      }
      return b.opportunity.score - a.opportunity.score;
    });
  }, [rows, sort, filter]);

  const act = (id: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      setMessage(result.ok ? (result.message ?? "Done.") : (result.error ?? "Something went wrong."));
      if (result.ok) setRows((prev) => prev.filter((r) => r.opportunity.id !== id));
    });
  };

  const refresh = () => {
    startTransition(async () => {
      const result = await refreshOpportunitiesAction();
      setMessage(result.ok ? (result.message ?? "Refreshed.") : result.error);
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line pb-4">
        <div className="flex items-center gap-2">
          <label htmlFor="filter" className="eyebrow mb-0">
            Show
          </label>
          <Select id="filter" value={filter} onChange={(e) => setFilter(e.target.value as FilterKey)}>
            {FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="sort" className="eyebrow mb-0">
            Sort by
          </label>
          <Select id="sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>

        <span className="tabular text-[12px] text-ink-faint">{visible.length} shown</span>

        <Button variant="secondary" size="sm" onClick={refresh} disabled={pending} className="ml-auto">
          <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden />
          {pending ? "Scanning…" : "Rescan database"}
        </Button>
      </div>

      {message ? <p className="mt-3 text-[12.5px] text-brass">{message}</p> : null}

      <div className="mt-4 flex flex-col gap-2.5">
        {visible.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing here"
              description="Either everyone is current, or the filter is too narrow. Try rescanning the database."
            />
          </Card>
        ) : (
          visible.map(({ opportunity, contact }) => (
            <Card key={opportunity.id} className="rise">
              <div className="px-5 pt-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[14.5px] font-semibold text-ink">{opportunity.title}</h3>
                      <Badge tone={opportunity.urgency === "critical" ? "urgent" : opportunity.urgency === "high" ? "warn" : "neutral"}>
                        <UrgencyDot urgency={opportunity.urgency} />
                        {opportunity.urgency}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[12px] text-ink-faint">
                      {contact ? CONTACT_TYPE_LABELS[contact.type] : "Contact"}
                      {contact?.neighborhood ? ` · ${contact.neighborhood}` : ""}
                      {contact ? ` · last spoke ${relativeDays(contact.lastPersonalContactAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="tabular text-[12px] text-ink-faint">Score {opportunity.score}</span>
                    <ConfidenceMeter value={opportunity.confidence} />
                  </div>
                </div>

                <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-muted">{opportunity.whyNow}</p>

                <div className="mt-3 rounded-[4px] border border-line bg-surface-sunk/60 px-3.5 py-3">
                  <div className="flex items-baseline gap-2">
                    <span className="eyebrow">Do this</span>
                    <span className="text-[11px] text-ink-faint">
                      · by {CHANNEL_LABELS[opportunity.recommendedChannel]}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] font-medium text-ink">{opportunity.recommendedAction}</p>
                  {opportunity.suggestedConversationStarter ? (
                    <p className="mt-2.5 border-l-2 border-brass/50 pl-3 text-[13px] italic leading-relaxed text-ink-muted">
                      {opportunity.suggestedConversationStarter}
                    </p>
                  ) : null}
                </div>

                {opportunity.supportingEvidence.length > 0 ? (
                  <ul className="mt-3 flex flex-col gap-1 border-l border-line pl-3">
                    {opportunity.supportingEvidence.map((e, i) => (
                      <li key={i} className="text-[12px] leading-relaxed">
                        <span className="font-medium text-ink">{e.label}:</span>{" "}
                        <span className="text-ink-muted">{e.detail}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line px-5 py-2.5">
                {contact ? (
                  <Link href={`/clients/${contact.id}`} className={buttonClasses("secondary", "sm")}>
                    View Contact
                  </Link>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => act(opportunity.id, () => snoozeOpportunityAction(opportunity.id, 14))}
                >
                  <Clock className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Snooze
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => act(opportunity.id, () => dismissOpportunityAction(opportunity.id))}
                >
                  <X className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Not now
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  className="ml-auto"
                  onClick={() => act(opportunity.id, () => markOpportunityActedAction(opportunity.id))}
                >
                  <Check className="size-3.5" strokeWidth={2} aria-hidden />
                  I reached out
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
