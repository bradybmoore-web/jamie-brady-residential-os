import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { LeadActions } from "@/components/leads/lead-actions";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageTitle,
  SectionTitle,
  SeedMarker,
  buttonClasses,
} from "@/components/ui/primitives";
import { LEAD_STAGE_LABELS, leadName } from "@/lib/types";
import { formatCurrency, formatDate, relativeDays } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const store = await getStore();
  const lead = await store.getLead(id);
  return { title: lead ? leadName(lead) : "Lead" };
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const store = await getStore();
  const lead = await store.getLead(id);
  if (!lead) notFound();

  const [actions, runs] = await Promise.all([store.listAIActions(), store.listAIRuns()]);
  const drafts = actions.filter((a) => a.leadId === lead.id);
  const analysisRun = lead.analysisRunId ? runs.find((r) => r.id === lead.analysisRunId) : undefined;

  return (
    <div className="px-4 py-7 lg:px-8">
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
        All leads
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <PageTitle>{leadName(lead)}</PageTitle>
            {lead.isSeed ? <SeedMarker /> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="brass">{LEAD_STAGE_LABELS[lead.stage]}</Badge>
            <Badge tone="outline" className="capitalize">
              {lead.type}
            </Badge>
            <span className="tabular text-[12.5px] text-ink-muted">Score {lead.score}</span>
            <span className="text-[12.5px] capitalize text-ink-muted">· {lead.urgency} urgency</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[12.5px] text-ink-muted">
            {lead.phone ? (
              <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 hover:text-brass">
                <Phone className="size-3.5" strokeWidth={1.75} aria-hidden />
                {lead.phone}
              </a>
            ) : null}
            {lead.email ? (
              <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 hover:text-brass">
                <Mail className="size-3.5" strokeWidth={1.75} aria-hidden />
                {lead.email}
              </a>
            ) : null}
            <span>
              {lead.source} · {relativeDays(lead.inquiredAt)}
            </span>
          </div>
        </div>

        <LeadActions leadId={lead.id} stage={lead.stage} />
      </header>

      <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>What they said</CardTitle>
              <span className="text-[11.5px] text-ink-faint">{formatDate(lead.inquiredAt)}</span>
            </CardHeader>
            <CardContent>
              <blockquote className="border-l-2 border-line-strong pl-4 text-[13.5px] leading-relaxed text-ink">
                {lead.inquiryContent}
              </blockquote>
            </CardContent>
          </Card>

          {lead.aiSummary || lead.aiRecommendedAction ? (
            <Card>
              <CardHeader>
                <CardTitle>What the system makes of it</CardTitle>
                {analysisRun ? (
                  <span className="text-[11px] text-ink-faint">
                    {analysisRun.provider === "mock" ? "Heuristic classifier" : analysisRun.model} ·{" "}
                    {analysisRun.promptVersion}
                  </span>
                ) : null}
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {lead.aiSummary ? (
                  <p className="text-[13.5px] leading-relaxed text-ink">{lead.aiSummary}</p>
                ) : null}
                {lead.aiRecommendedAction ? (
                  <div className="rounded-[4px] border border-line bg-surface-sunk/60 px-3.5 py-3">
                    <div className="eyebrow">Recommended next action</div>
                    <p className="mt-1 text-[13px] font-medium text-ink">{lead.aiRecommendedAction}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {lead.draftedResponse ? (
            <Card>
              <CardHeader>
                <CardTitle>Drafted reply</CardTitle>
                <Badge tone="warn">Needs your review</Badge>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink">
                  {lead.draftedResponse}
                </pre>
                {drafts.length > 0 ? (
                  <Link href="/approvals" className={`${buttonClasses("primary", "sm")} mt-4`}>
                    Review and send from Approvals
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-2.5">
                <Detail label="Assigned to" value="Jamie Moore" />
                <Detail label="Property" value={lead.propertyAddress} />
                <Detail label="Desired area" value={lead.desiredArea} />
                <Detail
                  label="Price range"
                  value={
                    lead.priceRangeMin || lead.priceRangeMax
                      ? `${formatCurrency(lead.priceRangeMin)} – ${formatCurrency(lead.priceRangeMax)}`
                      : null
                  }
                />
                <Detail label="Timeline" value={lead.estimatedTimeline} />
                <Detail label="Contact attempts" value={String(lead.attemptCount)} />
                <Detail label="Last attempt" value={lead.lastAttemptAt ? relativeDays(lead.lastAttemptAt) : null} />
                <Detail label="Follow-up due" value={lead.followUpDueAt ? formatDate(lead.followUpDueAt) : null} />
                <Detail label="Cloze ID" value={lead.clozeId ?? "Not synced"} />
              </dl>
            </CardContent>
          </Card>

          <section>
            <SectionTitle>Audit</SectionTitle>
            <Card className="mt-2.5">
              <CardContent className="pt-4">
                {analysisRun ? (
                  <dl className="flex flex-col gap-2 text-[12px]">
                    <Detail label="Workflow" value={analysisRun.workflow} />
                    <Detail label="Prompt version" value={analysisRun.promptVersion} />
                    <Detail label="Model" value={`${analysisRun.model} (${analysisRun.provider})`} />
                    <Detail label="Records read" value={String(analysisRun.inputRecordIds.length)} />
                    <Detail label="Latency" value={`${analysisRun.latencyMs} ms`} />
                    <Detail label="Run at" value={formatDate(analysisRun.startedAt)} />
                  </dl>
                ) : (
                  <p className="text-[12.5px] text-ink-muted">
                    This lead has not been analysed yet. Use Re-analyse above.
                  </p>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="eyebrow mb-0 shrink-0">{label}</dt>
      <dd className="text-right text-[12.5px] text-ink">{value || <span className="text-ink-faint">—</span>}</dd>
    </div>
  );
}
