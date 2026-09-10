import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { buildContext } from "@/lib/scoring/context";
import { buildListingActions } from "@/lib/scoring/priorities";
import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  PageTitle,
  SectionTitle,
  SeedMarker,
  UrgencyDot,
  buttonClasses,
} from "@/components/ui/primitives";
import { LISTING_STATUS_LABELS, type Listing, type ListingStatus, type Property } from "@/lib/types";
import { daysBetween, formatCurrency, formatDate, relativeDays } from "@/lib/utils";

export const metadata: Metadata = { title: "Listings" };
export const dynamic = "force-dynamic";

/** Listings are grouped by where they are in their life, in that order. */
const GROUPS: ListingStatus[] = ["pre_listing", "coming_soon", "active", "price_change", "pending", "closed"];

export default async function ListingsPage() {
  const session = await requireSession();
  const store = await getStore();
  const dataset = await store.snapshot();
  const ctx = buildContext(dataset, session.profileId);
  const actions = buildListingActions(ctx, { ownerOnly: false });

  const actionsByListing = new Map<string, typeof actions>();
  for (const action of actions) {
    const list = actionsByListing.get(action.listingId);
    if (list) list.push(action);
    else actionsByListing.set(action.listingId, [action]);
  }

  const grouped = GROUPS.map((status) => ({
    status,
    listings: dataset.listings.filter((l) => l.status === status),
  })).filter((g) => g.listings.length > 0);

  return (
    <div className="px-4 py-7 lg:px-8">
      <header>
        <p className="eyebrow">Portfolio</p>
        <PageTitle className="mt-1.5">Listings</PageTitle>
        <p className="mt-1.5 text-[13.5px] text-ink-muted">
          {dataset.listings.filter((l) => ["active", "price_change"].includes(l.status)).length} on the market ·{" "}
          {dataset.listings.filter((l) => l.status === "coming_soon").length} coming soon · {actions.length} items
          needing attention
        </p>
      </header>

      <div className="mt-7 flex flex-col gap-8">
        {grouped.length === 0 ? (
          <Card>
            <EmptyState title="No listings yet" description="Listings added here drive the marketing studio and seller updates." />
          </Card>
        ) : (
          grouped.map((group) => (
            <section key={group.status}>
              <div className="flex items-baseline gap-2">
                <SectionTitle>{LISTING_STATUS_LABELS[group.status]}</SectionTitle>
                <span className="tabular text-[11.5px] text-ink-faint">{group.listings.length}</span>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {group.listings.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    property={ctx.propertyById.get(listing.propertyId)}
                    actions={actionsByListing.get(listing.id) ?? []}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function ListingCard({
  listing,
  property,
  actions,
}: {
  listing: Listing;
  property?: Property;
  actions: { action: string; detail: string; urgency: "low" | "medium" | "high" | "critical" }[];
}) {
  const daysActive = listing.listedAt ? daysBetween(listing.listedAt) : null;
  const nextUpdate = listing.lastSellerUpdateAt
    ? listing.sellerUpdateCadenceDays - daysBetween(listing.lastSellerUpdateAt)
    : null;

  return (
    <Card className="flex flex-col">
      <div className="px-5 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/listings/${listing.id}`} className="text-[15px] font-semibold text-ink hover:text-brass">
              {property?.address ?? "Unknown address"}
            </Link>
            <p className="mt-0.5 text-[12px] text-ink-faint">
              {property?.neighborhood ? `${property.neighborhood}, ` : ""}
              {property?.city} {property?.postalCode}
              {listing.isSeed ? <SeedMarker className="ml-1.5" /> : null}
            </p>
          </div>
          <div className="text-right">
            <div className="tabular text-[15px] font-semibold text-ink">{formatCurrency(listing.listPrice)}</div>
            {listing.listPrice !== listing.originalListPrice ? (
              <div className="tabular text-[11px] text-ink-faint line-through">
                {formatCurrency(listing.originalListPrice)}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted">
          <span>
            {property?.beds ?? "?"} bd · {property?.baths ?? "?"} ba ·{" "}
            {property?.squareFeet?.toLocaleString() ?? "?"} sf
          </span>
          {daysActive !== null ? <span>· {daysActive} days active</span> : null}
        </div>
      </div>

      <CardContent className="pt-3">
        <dl className="grid grid-cols-3 gap-2 rounded-[4px] bg-surface-sunk/60 px-3 py-2.5">
          <Metric label="Showings" value={`${listing.showingsThisWeek}`} sub={`${listing.totalShowings} total`} />
          <Metric label="Inquiries" value={`${listing.inquiriesThisWeek}`} sub="this week" />
          <Metric
            label="Seller report"
            value={nextUpdate === null ? "Due" : nextUpdate <= 0 ? "Due" : `${nextUpdate}d`}
            sub={listing.lastSellerUpdateAt ? relativeDays(listing.lastSellerUpdateAt) : "never sent"}
          />
        </dl>

        {listing.lastActivitySummary ? (
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-muted">
            <span className="eyebrow mr-1.5 inline">Latest</span>
            {listing.lastActivitySummary}
          </p>
        ) : null}

        {actions.length > 0 ? (
          <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
            <div className="eyebrow">Recommended</div>
            {actions.slice(0, 2).map((a, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="mt-1.5">
                  <UrgencyDot urgency={a.urgency} />
                </span>
                <div>
                  <p className="text-[12.5px] font-medium text-ink">{a.action}</p>
                  <p className="text-[12px] leading-relaxed text-ink-faint">{a.detail}</p>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {listing.openHouseDates.length > 0 ? (
          <p className="mt-3 text-[12px] text-ink-faint">
            Open house {formatDate(listing.openHouseDates[0])}
          </p>
        ) : null}
      </CardContent>

      <div className="mt-auto flex flex-wrap gap-2 border-t border-line px-5 py-3">
        <Link href={`/listings/${listing.id}`} className={buttonClasses("secondary", "sm")}>
          Open
        </Link>
        <Link href={`/marketing/${listing.id}`} className={buttonClasses("secondary", "sm")}>
          Marketing Studio
        </Link>
        {listing.status !== "closed" ? (
          <Badge tone="outline" className="ml-auto self-center">
            {LISTING_STATUS_LABELS[listing.status]}
          </Badge>
        ) : null}
      </div>
    </Card>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="tabular mt-0.5 text-[15px] font-semibold text-ink">{value}</dd>
      <dd className="text-[10.5px] text-ink-faint">{sub}</dd>
    </div>
  );
}
