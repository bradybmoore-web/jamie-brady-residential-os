import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { getMlsProvider } from "@/lib/integrations/mls";
import { capabilities } from "@/lib/env";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageTitle,
  SeedMarker,
} from "@/components/ui/primitives";
import { contactName, type BuyerProfile } from "@/lib/types";
import { formatCurrency, relativeDays } from "@/lib/utils";
import type { MlsProperty } from "@/lib/integrations/mls";

export const metadata: Metadata = { title: "Buyers" };
export const dynamic = "force-dynamic";

export default async function BuyersPage() {
  await requireSession();
  const store = await getStore();
  const [buyers, contacts] = await Promise.all([store.listBuyers(), store.listContacts()]);
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const mls = await getMlsProvider();

  // Fit scoring runs against the MLS adapter, so it lights up for real the day a
  // licensed feed is connected — the code path is identical.
  const withMatches = await Promise.all(
    buyers
      .filter((b) => b.active)
      .map(async (buyer) => ({
        buyer,
        contact: contactById.get(buyer.contactId) ?? null,
        matches: await findMatches(buyer, mls),
      })),
  );

  return (
    <div className="px-4 py-7 lg:px-8">
      <header>
        <p className="eyebrow">Active demand</p>
        <PageTitle className="mt-1.5">Buyers</PageTitle>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
          What each buyer actually needs, in enough detail to score a listing against it. The matching below runs
          through the MLS adapter — {capabilities.mls ? "live data" : "currently a local mock feed"}.
        </p>
      </header>

      {withMatches.length === 0 ? (
        <Card className="mt-6">
          <EmptyState title="No active buyers" description="Buyer profiles appear here once a lead converts." />
        </Card>
      ) : (
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {withMatches.map(({ buyer, contact, matches }) => (
            <Card key={buyer.id}>
              <CardHeader>
                <div>
                  <CardTitle>
                    {contact ? (
                      <Link href={`/clients/${contact.id}`} className="hover:text-brass">
                        {contactName(contact)}
                      </Link>
                    ) : (
                      "Buyer"
                    )}
                    {buyer.isSeed ? <SeedMarker className="ml-1.5" /> : null}
                  </CardTitle>
                  <p className="mt-0.5 text-[12px] text-ink-faint">
                    {formatCurrency(buyer.priceMin)} – {formatCurrency(buyer.priceMax)} · {buyer.minBeds}+ bd ·{" "}
                    {buyer.minBaths}+ ba
                    {buyer.lastShowingAt ? ` · last out ${relativeDays(buyer.lastShowingAt)}` : ""}
                  </p>
                </div>
                {buyer.preApproved ? <Badge tone="good">Pre-approved</Badge> : <Badge tone="warn">Not verified</Badge>}
              </CardHeader>

              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {buyer.targetLocations.map((l) => (
                    <Badge key={l} tone="outline" className="normal-case tracking-normal">
                      {l}
                    </Badge>
                  ))}
                </div>

                <Group label="Must have" items={buyer.mustHaves} />
                <Group label="Deal breakers" items={buyer.dealBreakers} tone="urgent" />
                <Group label="Nice to have" items={buyer.niceToHaves} />
                {buyer.emotionalReactions.length > 0 ? (
                  <Group label="What they actually responded to" items={buyer.emotionalReactions} />
                ) : null}

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-[4px] bg-surface-sunk/60 px-3 py-2.5 text-[12px]">
                  <Fact label="Pool" value={buyer.poolPreference} />
                  <Fact label="One story" value={buyer.oneStoryPreference} />
                  <Fact label="Timeline" value={buyer.timeline ?? "—"} />
                  <Fact label="Lender" value={buyer.lenderName ?? "—"} />
                </dl>

                <div className="border-t border-line pt-3">
                  <div className="eyebrow">
                    Inventory fit {capabilities.mls ? "" : "(mock feed)"}
                  </div>
                  {matches.length === 0 ? (
                    <p className="mt-1 text-[12.5px] text-ink-muted">
                      Nothing on the market fits this profile right now.
                    </p>
                  ) : (
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {matches.slice(0, 3).map((m) => (
                        <li key={m.property.mlsNumber} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                          <span className="truncate text-ink">
                            {m.property.address}, {m.property.city}
                          </span>
                          <span className="tabular shrink-0 text-ink-muted">
                            {formatCurrency(m.property.listPrice)} · {m.score}% fit
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

interface Match {
  property: MlsProperty;
  score: number;
}

/**
 * Listing-fit scoring.
 *
 * Hard requirements gate; preferences weight. Kept simple deliberately — a
 * transparent 0-100 an agent can sanity-check beats a clever model she cannot.
 */
async function findMatches(buyer: BuyerProfile, mls: Awaited<ReturnType<typeof getMlsProvider>>): Promise<Match[]> {
  const results = await mls.searchProperties({
    priceMin: Math.round(buyer.priceMin * 0.9),
    priceMax: Math.round(buyer.priceMax * 1.05),
    beds: buyer.minBeds || undefined,
    status: ["active", "coming_soon"],
    limit: 40,
  });

  return results
    .map((property) => {
      let score = 55;

      // Location is the strongest signal an agent has.
      const inTarget = buyer.targetLocations.some(
        (l) =>
          property.neighborhood?.toLowerCase().includes(l.toLowerCase()) ||
          property.city.toLowerCase().includes(l.toLowerCase()) ||
          property.postalCode === l,
      );
      score += inTarget ? 25 : -30;

      if (property.listPrice <= buyer.priceMax) score += 8;
      else score -= 12;
      if (property.listPrice >= buyer.priceMin) score += 4;

      if (buyer.preferredSquareFeet && (property.squareFeet ?? 0) >= buyer.preferredSquareFeet) score += 6;
      if (buyer.poolPreference === "required") score += property.hasPool ? 10 : -40;
      else if (buyer.poolPreference === "preferred") score += property.hasPool ? 7 : 0;
      else if (buyer.poolPreference === "avoid" && property.hasPool) score -= 15;

      if (buyer.oneStoryPreference === "required") score += property.stories === 1 ? 10 : -25;
      else if (buyer.oneStoryPreference === "preferred" && property.stories === 1) score += 6;

      return { property, score: Math.max(0, Math.min(100, score)) };
    })
    .filter((m) => m.score >= 60)
    .sort((a, b) => b.score - a.score);
}

function Group({ label, items, tone }: { label: string; items: string[]; tone?: "urgent" }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {items.map((item, i) => (
          <li key={i} className={`text-[12.5px] leading-relaxed ${tone === "urgent" ? "text-urgent" : "text-ink-muted"}`}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="eyebrow mb-0">{label}</dt>
      <dd className="truncate capitalize text-ink">{value}</dd>
    </div>
  );
}
