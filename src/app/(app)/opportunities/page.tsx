import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { identifyFollowUpOpportunities } from "@/lib/workflows/follow-up";
import { OpportunityList, type OpportunityRow } from "@/components/opportunities/opportunity-list";
import { Card, CardContent, PageTitle, Stat } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Opportunities" };
export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const session = await requireSession();
  const store = await getStore();

  let opportunities = (await store.listOpportunities()).filter((o) => o.status === "open");
  if (opportunities.length === 0) {
    const result = await identifyFollowUpOpportunities(session.profileId);
    opportunities = result.opportunities;
  }

  const contacts = await store.listContacts();
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const rows: OpportunityRow[] = opportunities
    .sort((a, b) => b.score - a.score)
    .map((opportunity) => ({
      opportunity,
      contact: opportunity.contactId ? (contactById.get(opportunity.contactId) ?? null) : null,
    }));

  const critical = rows.filter((r) => r.opportunity.urgency === "critical" || r.opportunity.urgency === "high").length;
  const strong = rows.filter((r) => r.opportunity.confidence >= 0.75).length;

  return (
    <div className="px-4 py-7 lg:px-8">
      <header>
        <p className="eyebrow">Relationship intelligence</p>
        <PageTitle className="mt-1.5">Relationship Opportunities</PageTitle>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
          Not a list of old tasks. This reads across time since the last real conversation, things people told
          you they were going to do, what they are opening and clicking, closing anniversaries, and whether an
          active client has gone quiet — then weighs those against what kind of relationship it is.
        </p>
      </header>

      <Card className="mt-6 overflow-hidden">
        <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
          <Stat label="Open opportunities" value={rows.length} />
          <Stat label="Urgent" value={critical} tone={critical > 0 ? "warn" : "neutral"} />
          <Stat label="Strong signal" value={strong} hint="corroborated by three or more signals" />
        </div>
      </Card>

      <div className="mt-6">
        <OpportunityList rows={rows} />
      </div>

      <Card className="mt-8">
        <CardContent className="pt-4">
          <div className="eyebrow">How this is scored</div>
          <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-ink-muted">
            Every relationship type has an expected cadence — an active buyer is overdue at five days, a sphere
            contact at four months. Lapses are weighted by type and saturate rather than growing without bound, so
            a contact you have not spoken to in three years does not permanently outrank a client waiting on an
            answer today. Stated plans that have come due, unanswered inbound email, repeated marketing
            engagement, property clicks and closing anniversaries each add their own weight. Confidence reflects
            how many independent signals agree, not how loud any one of them was. Nothing appears here without a
            record behind it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
