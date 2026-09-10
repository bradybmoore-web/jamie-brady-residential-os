import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import {
  Badge,
  Card,
  EmptyState,
  PageTitle,
  SeedMarker,
  Table,
  Td,
  Th,
  UrgencyDot,
} from "@/components/ui/primitives";
import { NewLeadDialog } from "@/components/leads/new-lead";
import { LEAD_STAGE_LABELS, leadName, type Lead } from "@/lib/types";
import { daysBetween, relativeDays, truncate } from "@/lib/utils";

export const metadata: Metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

/**
 * Four views, because there are only four questions worth asking about a lead
 * pipeline: who is new, who is worth the most, who is waiting on me, and who is
 * slipping.
 */
const VIEWS = [
  { key: "new", label: "New" },
  { key: "hot", label: "Hot" },
  { key: "waiting", label: "Waiting" },
  { key: "due", label: "Follow-up Due" },
  { key: "all", label: "All" },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

function filterLeads(leads: Lead[], view: ViewKey): Lead[] {
  const now = new Date();
  switch (view) {
    case "new":
      return leads.filter((l) => l.stage === "new");
    case "hot":
      return leads.filter(
        (l) => l.score >= 75 && !["converted", "closed", "lost"].includes(l.stage),
      );
    case "waiting":
      return leads.filter(
        (l) => l.attemptCount > 0 && ["attempted_contact", "connected"].includes(l.stage),
      );
    case "due":
      return leads.filter(
        (l) =>
          l.followUpDueAt !== null &&
          l.followUpDueAt !== undefined &&
          daysBetween(l.followUpDueAt, now) >= 0 &&
          !["converted", "closed", "lost"].includes(l.stage),
      );
    default:
      return leads;
  }
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  await requireSession();
  const params = await searchParams;
  const store = await getStore();
  const leads = (await store.listLeads()).sort((a, b) => b.score - a.score);

  // An explicitly chosen view is always honoured. Without one, land on the
  // first view that actually has something in it — arriving on an empty "New"
  // tab when four follow-ups are overdue is the wrong first impression.
  const requested = VIEWS.find((v) => v.key === params.view)?.key;
  const view = (requested ??
    VIEWS.find((v) => filterLeads(leads, v.key).length > 0)?.key ??
    "new") as ViewKey;

  const visible = filterLeads(leads, view);

  return (
    <div className="px-4 py-7 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Pipeline</p>
          <PageTitle className="mt-1.5">Leads</PageTitle>
          <p className="mt-1.5 text-[13.5px] text-ink-muted">
            {leads.filter((l) => l.stage === "new").length} new · {filterLeads(leads, "due").length} follow-ups due ·{" "}
            {filterLeads(leads, "hot").length} scoring above 75
          </p>
        </div>
        <NewLeadDialog />
      </header>

      <nav className="mt-6 flex flex-wrap gap-1 border-b border-line" aria-label="Lead views">
        {VIEWS.map((v) => {
          const count = filterLeads(leads, v.key).length;
          const active = v.key === view;
          return (
            <Link
              key={v.key}
              href={`/leads?view=${v.key}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors ${
                active
                  ? "border-brass font-medium text-ink"
                  : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {v.label}
              <span className="tabular text-[11px] text-ink-faint">{count}</span>
            </Link>
          );
        })}
      </nav>

      <Card className="mt-5 overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            title={`Nothing in ${VIEWS.find((v) => v.key === view)?.label.toLowerCase()}`}
            description="When an inquiry arrives it is classified, scored and drafted a reply automatically."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-[52px]">Score</Th>
                <Th>Lead</Th>
                <Th className="hidden md:table-cell">Inquiry</Th>
                <Th className="hidden lg:table-cell">Source</Th>
                <Th>Stage</Th>
                <Th className="hidden sm:table-cell">Follow-up</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((lead) => (
                <tr key={lead.id} className="transition-colors hover:bg-surface-sunk/50">
                  <Td>
                    <span className="tabular flex items-center gap-1.5 font-semibold">
                      <UrgencyDot urgency={lead.urgency} />
                      {lead.score}
                    </span>
                  </Td>
                  <Td>
                    <Link href={`/leads/${lead.id}`} className="font-medium text-ink hover:text-brass">
                      {leadName(lead)}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-faint">
                      <span className="capitalize">{lead.type}</span>
                      {lead.desiredArea ? <span>· {lead.desiredArea}</span> : null}
                      {lead.isSeed ? <SeedMarker /> : null}
                    </div>
                  </Td>
                  <Td className="hidden max-w-[380px] md:table-cell">
                    <span className="text-[12.5px] leading-relaxed text-ink-muted">
                      {truncate(lead.inquiryContent, 150)}
                    </span>
                  </Td>
                  <Td className="hidden whitespace-nowrap text-[12.5px] text-ink-muted lg:table-cell">
                    {lead.source}
                    <div className="text-[11.5px] text-ink-faint">{relativeDays(lead.inquiredAt)}</div>
                  </Td>
                  <Td>
                    <Badge tone={stageTone(lead.stage)}>{LEAD_STAGE_LABELS[lead.stage]}</Badge>
                    {lead.attemptCount > 0 ? (
                      <div className="mt-1 text-[11px] text-ink-faint">
                        {lead.attemptCount} attempt{lead.attemptCount === 1 ? "" : "s"}
                      </div>
                    ) : null}
                  </Td>
                  <Td className="hidden whitespace-nowrap sm:table-cell">
                    {lead.followUpDueAt ? (
                      <span
                        className={
                          daysBetween(lead.followUpDueAt) >= 0
                            ? "text-[12.5px] font-medium text-urgent"
                            : "text-[12.5px] text-ink-muted"
                        }
                      >
                        {relativeDays(lead.followUpDueAt)}
                      </span>
                    ) : (
                      <span className="text-[12.5px] text-ink-faint">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <p className="mt-4 text-[11.5px] text-ink-faint">
        Scores combine the AI&rsquo;s read on intent and urgency with source quality, contactability, message
        substance and how many attempts have already failed.{" "}
        <Link href="/settings" className="text-brass hover:underline">
          See how this is configured
        </Link>
        .
      </p>
    </div>
  );
}

function stageTone(stage: Lead["stage"]) {
  switch (stage) {
    case "new":
      return "brass" as const;
    case "appointment_set":
    case "active_buyer":
    case "active_seller":
      return "good" as const;
    case "lost":
    case "closed":
      return "neutral" as const;
    case "nurture":
      return "info" as const;
    default:
      return "outline" as const;
  }
}
