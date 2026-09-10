import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { Badge, Card, CardContent, EmptyState, PageTitle, buttonClasses } from "@/components/ui/primitives";
import { LISTING_STATUS_LABELS, MARKETING_KIND_LABELS } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Marketing" };
export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  await requireSession();
  const store = await getStore();
  const [listings, properties, marketing] = await Promise.all([
    store.listListings(),
    store.listProperties(),
    store.listListingMarketing(),
  ]);
  const propertyById = new Map(properties.map((p) => [p.id, p]));

  const marketable = listings.filter((l) => l.status !== "closed" && l.status !== "withdrawn");

  return (
    <div className="px-4 py-7 lg:px-8">
      <header>
        <p className="eyebrow">Studio</p>
        <PageTitle className="mt-1.5">Marketing</PageTitle>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
          Sixteen formats per listing, written from that property&rsquo;s own facts and the seller&rsquo;s own rules.
          Everything is a draft until you approve it.
        </p>
      </header>

      {marketable.length === 0 ? (
        <Card className="mt-6">
          <EmptyState title="No listings to market" description="Add a listing to start generating content." />
        </Card>
      ) : (
        <div className="mt-6 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {marketable.map((listing) => {
            const property = propertyById.get(listing.propertyId);
            const produced = marketing.filter((m) => m.listingId === listing.id);
            const approved = produced.filter((m) => m.status === "approved");
            return (
              <Card key={listing.id} className="flex flex-col">
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-[14.5px] font-semibold text-ink">{property?.address}</h2>
                      <p className="mt-0.5 text-[12px] text-ink-faint">
                        {property?.neighborhood ?? property?.city} · {formatCurrency(listing.listPrice)}
                      </p>
                    </div>
                    <Badge tone="outline">{LISTING_STATUS_LABELS[listing.status]}</Badge>
                  </div>

                  <p className="mt-3 text-[12.5px] text-ink-muted">
                    {produced.length === 0
                      ? "Nothing written yet."
                      : `${produced.length} piece${produced.length === 1 ? "" : "s"} written, ${approved.length} approved.`}
                  </p>

                  {produced.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {produced.slice(0, 5).map((m) => (
                        <Badge key={m.id} tone={m.status === "approved" ? "good" : "neutral"}>
                          {MARKETING_KIND_LABELS[m.kind]}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
                <div className="mt-auto border-t border-line px-5 py-3">
                  <Link href={`/marketing/${listing.id}`} className={buttonClasses("primary", "sm")}>
                    Open Listing Studio
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
