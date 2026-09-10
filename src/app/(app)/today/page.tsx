import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, Lightbulb } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { dailyCommandCenter } from "@/lib/workflows/daily-command-center";
import { identifyFollowUpOpportunities } from "@/lib/workflows/follow-up";
import { PriorityCard } from "@/components/today/priority-card";
import { TodaySchedule, type ScheduleItem } from "@/components/today/schedule";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageTitle,
  SectionTitle,
  Stat,
  UrgencyDot,
  buttonClasses,
} from "@/components/ui/primitives";
import { contactName, type Opportunity } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const session = await requireSession();
  const store = await getStore();

  const { brief, provider } = await dailyCommandCenter(session.profileId);

  // Opportunities are generated once and then reused; the Today page shows the
  // top few, the Opportunities screen shows all of them.
  let opportunities = (await store.listOpportunities()).filter((o) => o.status === "open");
  if (opportunities.length === 0) {
    const result = await identifyFollowUpOpportunities(session.profileId);
    opportunities = result.opportunities;
  }

  const [events, contacts, properties, listings, sellerUpdates, preps] = await Promise.all([
    store.listCalendarEvents(),
    store.listContacts(),
    store.listProperties(),
    store.listListings(),
    store.listSellerUpdates(),
    Promise.all(brief.appointments.map((id) => store.getAppointmentPrepFor(id))),
  ]);

  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const propertyById = new Map(properties.map((p) => [p.id, p]));
  const listingById = new Map(listings.map((l) => [l.id, l]));

  const scheduleItems: ScheduleItem[] = brief.appointments
    .map((id, i) => {
      const event = events.find((e) => e.id === id);
      if (!event) return null;
      const listing = event.listingId ? listingById.get(event.listingId) : undefined;
      return {
        event,
        attendees: event.contactIds
          .map((cid) => contactById.get(cid))
          .filter((c) => c !== undefined)
          .map((c) => contactName(c)),
        listingAddress: listing ? (propertyById.get(listing.propertyId)?.address ?? null) : null,
        prep: preps[i] ?? null,
      } satisfies ScheduleItem;
    })
    .filter((x): x is ScheduleItem => x !== null);

  const firstName = session.fullName.split(" ")[0];
  const greeting = getGreeting();
  const topOpportunities = [...opportunities].sort((a, b) => b.score - a.score).slice(0, 4);

  return (
    <div className="px-4 py-7 lg:px-8">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{formatDate(new Date().toISOString(), "long")}</p>
          <PageTitle className="mt-1.5">
            {greeting}, {firstName}
          </PageTitle>
          <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
            {summaryLine(brief.peopleNeedingAttention.length, brief.metrics.appointmentsToday, brief.metrics.followUpsOverdue)}
          </p>
        </div>
        <Link href="/assistant" className={buttonClasses("secondary", "md")}>
          Ask the assistant
          <ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden />
        </Link>
      </header>

      {/* Metrics */}
      <Card className="mt-6 overflow-hidden">
        <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-6 lg:divide-x">
          <Stat label="Tasks due" value={brief.metrics.tasksDue} />
          <Stat label="New leads" value={brief.metrics.newLeads} tone={brief.metrics.newLeads > 0 ? "good" : "neutral"} />
          <Stat
            label="Follow-ups overdue"
            value={brief.metrics.followUpsOverdue}
            tone={brief.metrics.followUpsOverdue > 0 ? "urgent" : "neutral"}
          />
          <Stat label="Appointments" value={brief.metrics.appointmentsToday} />
          <Stat
            label="Seller reports due"
            value={brief.metrics.sellerReportsDue}
            tone={brief.metrics.sellerReportsDue > 0 ? "warn" : "neutral"}
          />
          <Stat
            label="Marketing due"
            value={brief.metrics.marketingTasksDue}
            tone={brief.metrics.marketingTasksDue > 0 ? "warn" : "neutral"}
          />
        </div>
      </Card>

      {/* Warnings */}
      {brief.warnings.length > 0 ? (
        <div className="mt-4 rounded-[6px] border border-line bg-warn-soft/50 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 text-warn" strokeWidth={2} aria-hidden />
            <span className="eyebrow text-warn">Worth knowing</span>
          </div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {brief.warnings.map((w, i) => (
              <li key={i} className="text-[12.5px] leading-relaxed text-ink-muted">
                {w}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-7 grid gap-7 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* People who need you */}
        <section>
          <div className="flex items-baseline justify-between gap-3">
            <SectionTitle>People Who Need You</SectionTitle>
            <span className="text-[11.5px] text-ink-faint">
              Ranked by urgency and evidence · {provider === "mock" ? "templated language" : "written by Claude"}
            </span>
          </div>

          <div className="mt-3 flex flex-col gap-2.5">
            {brief.peopleNeedingAttention.length === 0 ? (
              <Card>
                <EmptyState
                  title="Nobody is waiting on you"
                  description="No overdue follow-ups, no unanswered threads, no relationships past their cadence. This is the rarest screen in the product."
                />
              </Card>
            ) : (
              brief.peopleNeedingAttention.map((p, i) => <PriorityCard key={p.id} priority={p} rank={i + 1} />)
            )}
          </div>
        </section>

        {/* Right column */}
        <div className="flex flex-col gap-7">
          <section>
            <SectionTitle>Today&rsquo;s Schedule</SectionTitle>
            <div className="mt-3">
              <TodaySchedule items={scheduleItems} />
            </div>
          </section>

          <section>
            <div className="flex items-baseline justify-between gap-3">
              <SectionTitle>Listing Attention</SectionTitle>
              <Link href="/listings" className="text-[11.5px] text-brass hover:underline">
                All listings
              </Link>
            </div>
            <Card className="mt-3 overflow-hidden">
              {brief.listingActions.length === 0 ? (
                <EmptyState title="Listings are current" description="No seller updates or marketing overdue." />
              ) : (
                <ul className="divide-y divide-line">
                  {brief.listingActions.slice(0, 5).map((action, i) => (
                    <li key={`${action.listingId}-${i}`} className="px-5 py-3.5">
                      <div className="flex items-start gap-2">
                        <Building2 className="mt-0.5 size-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-medium text-ink">{action.address}</span>
                            <UrgencyDot urgency={action.urgency} />
                          </div>
                          <p className="mt-0.5 text-[12.5px] font-medium text-ink-muted">{action.action}</p>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-faint">{action.detail}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Link
                              href={
                                action.sellerUpdateId
                                  ? `/listings/${action.listingId}#seller-updates`
                                  : action.marketingAssetKind
                                    ? `/marketing/${action.listingId}?kind=${action.marketingAssetKind}`
                                    : `/listings/${action.listingId}`
                              }
                              className={buttonClasses("secondary", "sm")}
                            >
                              {action.sellerUpdateId
                                ? "Review Draft"
                                : action.marketingAssetKind
                                  ? "Write It"
                                  : "Open Listing"}
                            </Link>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <section>
            <div className="flex items-baseline justify-between gap-3">
              <SectionTitle>AI Opportunities</SectionTitle>
              <Link href="/opportunities" className="text-[11.5px] text-brass hover:underline">
                See all {opportunities.length}
              </Link>
            </div>
            <Card className="mt-3 overflow-hidden">
              {topOpportunities.length === 0 ? (
                <EmptyState
                  title="Nothing surfaced yet"
                  description="Opportunities appear as engagement, stated plans and relationship gaps accumulate."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {topOpportunities.map((o) => (
                    <OpportunityRow key={o.id} opportunity={o} />
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      </div>

      {/* Seller updates awaiting review */}
      {brief.sellerUpdates.length > 0 ? (
        <section className="mt-7">
          <SectionTitle>Seller Updates Awaiting Review</SectionTitle>
          <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
            {brief.sellerUpdates.slice(0, 4).map((id) => {
              const update = sellerUpdates.find((u) => u.id === id);
              if (!update) return null;
              const listing = listingById.get(update.listingId);
              const address = listing ? propertyById.get(listing.propertyId)?.address : "Listing";
              return (
                <Card key={id}>
                  <CardHeader>
                    <CardTitle>{address}</CardTitle>
                    <Badge tone="warn">Needs review</Badge>
                  </CardHeader>
                  <CardContent>
                    <p className="text-[12.5px] leading-relaxed text-ink-muted">{update.recommendedAction}</p>
                    <Link
                      href={`/listings/${update.listingId}#seller-updates`}
                      className={`${buttonClasses("secondary", "sm")} mt-3`}
                    >
                      Review Draft
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function OpportunityRow({ opportunity }: { opportunity: Opportunity }) {
  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-brass" strokeWidth={1.75} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{opportunity.title}</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">{opportunity.whyNow}</p>
          {opportunity.suggestedConversationStarter ? (
            <p className="mt-1.5 border-l-2 border-brass/40 pl-2.5 text-[12px] italic leading-relaxed text-ink-faint">
              {opportunity.suggestedConversationStarter}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function getGreeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Chicago" }).format(
      new Date(),
    ),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function summaryLine(people: number, appointments: number, overdue: number) {
  const parts: string[] = [];
  if (people > 0) parts.push(`${people} ${people === 1 ? "person needs" : "people need"} you`);
  if (appointments > 0) parts.push(`${appointments} ${appointments === 1 ? "appointment" : "appointments"}`);
  if (overdue > 0) parts.push(`${overdue} overdue follow-${overdue === 1 ? "up" : "ups"}`);
  if (parts.length === 0) return "Nothing is outstanding. Good day to prospect.";
  return `${parts.join(", ")}. Start at the top.`;
}
