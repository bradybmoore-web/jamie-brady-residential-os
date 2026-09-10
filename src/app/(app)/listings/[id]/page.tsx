import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { capabilities } from "@/lib/env";
import { buildContext } from "@/lib/scoring/context";
import { buildListingActions } from "@/lib/scoring/priorities";
import { SellerUpdatePanel } from "@/components/listings/seller-update-panel";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageTitle,
  SeedMarker,
  Stat,
  UrgencyDot,
  buttonClasses,
} from "@/components/ui/primitives";
import { LISTING_STATUS_LABELS, MARKETING_KIND_LABELS, contactName } from "@/lib/types";
import { daysBetween, formatCurrency, formatDate, relativeDays } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const store = await getStore();
  const listing = await store.getListing(id);
  const property = listing ? await store.getProperty(listing.propertyId) : null;
  return { title: property?.address ?? "Listing" };
}

export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const store = await getStore();
  const dataset = await store.snapshot();

  // Captured once per request so every duration on the page agrees.
  const now = new Date();
  const listing = dataset.listings.find((l) => l.id === id);
  if (!listing) notFound();
  const property = dataset.properties.find((p) => p.id === listing.propertyId);

  const ctx = buildContext(dataset, session.profileId);
  const actions = buildListingActions(ctx, { ownerOnly: false }).filter((a) => a.listingId === id);
  const feedback = dataset.showingFeedback
    .filter((f) => f.listingId === id)
    .sort((a, b) => b.showingAt.localeCompare(a.showingAt));
  const updates = dataset.sellerUpdates
    .filter((u) => u.listingId === id)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const marketing = dataset.listingMarketing.filter((m) => m.listingId === id);
  const sellers = listing.sellerContactIds.map((cid) => ctx.contactById.get(cid)).filter((c) => c !== undefined);

  return (
    <div className="px-4 py-7 lg:px-8">
      <Link href="/listings" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
        All listings
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <PageTitle>{property?.address}</PageTitle>
            {listing.isSeed ? <SeedMarker /> : null}
          </div>
          <p className="mt-1.5 text-[13.5px] text-ink-muted">
            {property?.neighborhood ? `${property.neighborhood} · ` : ""}
            {property?.city}, {property?.state} {property?.postalCode}
            {property?.mlsNumber ? ` · MLS ${property.mlsNumber}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="brass">{LISTING_STATUS_LABELS[listing.status]}</Badge>
            <span className="tabular text-[18px] font-semibold text-ink">{formatCurrency(listing.listPrice)}</span>
            {listing.listPrice !== listing.originalListPrice ? (
              <span className="tabular text-[13px] text-ink-faint line-through">
                {formatCurrency(listing.originalListPrice)}
              </span>
            ) : null}
          </div>
        </div>

        <Link href={`/marketing/${listing.id}`} className={buttonClasses("primary", "md")}>
          Open Marketing Studio
        </Link>
      </header>

      {/* Performance */}
      <Card className="mt-6 overflow-hidden">
        <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 lg:divide-x">
          <Stat label="Showings this week" value={listing.showingsThisWeek} hint={`${listing.totalShowings} since launch`} />
          <Stat label="Inquiries" value={listing.inquiriesThisWeek} hint="this week" />
          <Stat label="Portal views" value={listing.portalViewsThisWeek} hint="this week" />
          <Stat label="Saves" value={listing.savesThisWeek} hint="this week" />
          <Stat
            label="Days on market"
            value={listing.listedAt ? Math.max(0, daysBetween(listing.listedAt, now)) : "—"}
            hint={listing.listedAt ? `listed ${formatDate(listing.listedAt)}` : "not yet listed"}
          />
        </div>
      </Card>

      {actions.length > 0 ? (
        <Card className="mt-4 border-brass/30 bg-brass-soft/25">
          <CardContent className="pt-4">
            <div className="eyebrow text-brass">What this listing needs</div>
            <ul className="mt-2 flex flex-col gap-2">
              {actions.map((a, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1.5">
                    <UrgencyDot urgency={a.urgency} />
                  </span>
                  <div>
                    <p className="text-[13px] font-medium text-ink">{a.action}</p>
                    <p className="text-[12.5px] leading-relaxed text-ink-muted">{a.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <SellerUpdatePanel listingId={listing.id} updates={updates} mlsIsMock={!capabilities.mls} />

          <Card>
            <CardHeader>
              <CardTitle>Showing feedback</CardTitle>
              <span className="text-[11.5px] text-ink-faint">{feedback.length} recorded</span>
            </CardHeader>
            <CardContent>
              {feedback.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No feedback recorded yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {feedback.map((f) => (
                    <li key={f.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12.5px] font-medium text-ink">{f.agentName}</span>
                        <span className="text-[11.5px] text-ink-faint">{formatDate(f.showingAt)}</span>
                        <Badge tone={f.buyerImpression === "positive" ? "good" : f.buyerImpression === "negative" ? "urgent" : "neutral"}>
                          {f.buyerImpression}
                        </Badge>
                        {f.priceReaction !== "unstated" ? (
                          <Badge tone={f.priceReaction === "over" ? "warn" : "outline"}>price {f.priceReaction}</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">{f.comments}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>The property</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <Detail label="Beds" value={String(property?.beds ?? "—")} />
                <Detail label="Baths" value={`${property?.baths ?? "—"}${property?.halfBaths ? ` + ${property.halfBaths} half` : ""}`} />
                <Detail label="Square feet" value={property?.squareFeet?.toLocaleString() ?? "—"} />
                <Detail label="Lot" value={property?.lotSizeAcres ? `${property.lotSizeAcres} acres` : "—"} />
                <Detail label="Year built" value={String(property?.yearBuilt ?? "—")} />
                <Detail label="Stories" value={String(property?.stories ?? "—")} />
                <Detail label="Pool" value={property?.hasPool ? "Yes" : "No"} />
                <Detail label="Schools" value={property?.schoolDistrict ?? "—"} />
              </dl>

              <div className="mt-4 border-t border-line pt-3">
                <div className="eyebrow">Sellers</div>
                <p className="mt-1 text-[13px] text-ink">{listing.sellerNames}</p>
                {sellers.map((s) => (
                  <Link
                    key={s.id}
                    href={`/clients/${s.id}`}
                    className="mt-1 block text-[12px] text-brass hover:underline"
                  >
                    {contactName(s)} · last spoke {relativeDays(s.lastPersonalContactAt)}
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Positioning</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-[13px] leading-relaxed text-ink">{listing.positioning}</p>

              <ListSection title="Major features" items={listing.majorFeatures} />
              <ListSection title="Improvements" items={listing.improvements} />
              <ListSection title="Lifestyle" items={listing.lifestylePoints} />
              <ListSection title="Nearby" items={listing.nearbyDestinations} />

              {listing.writingNotes ? (
                <div className="rounded-[4px] border border-line bg-surface-sunk/60 px-3 py-2.5">
                  <div className="eyebrow">Writing notes</div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{listing.writingNotes}</p>
                </div>
              ) : null}

              {listing.prohibitedPhrases.length > 0 ? (
                <div>
                  <div className="eyebrow">Never say</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {listing.prohibitedPhrases.map((p) => (
                      <Badge key={p} tone="urgent" className="normal-case tracking-normal">
                        {p}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Marketing produced</CardTitle>
              <Link href={`/marketing/${listing.id}`} className="text-[11.5px] text-brass hover:underline">
                Studio
              </Link>
            </CardHeader>
            <CardContent>
              {marketing.length === 0 ? (
                <p className="text-[13px] text-ink-muted">Nothing generated for this listing yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {marketing.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3">
                      <span className="text-[12.5px] text-ink">{MARKETING_KIND_LABELS[m.kind]}</span>
                      <Badge tone={m.status === "approved" ? "good" : "neutral"}>{m.status.replace(/_/g, " ")}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-ink-faint">{listing.brokerageDisclaimer}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-ink">{value}</dd>
    </div>
  );
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="eyebrow">{title}</div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={i} className="text-[12.5px] leading-relaxed text-ink-muted before:mr-1.5 before:text-ink-faint before:content-['—']">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
