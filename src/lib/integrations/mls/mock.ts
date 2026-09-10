import { daysBeforeNow } from "@/lib/utils";
import type {
  ComparablesCriteria,
  ComparablesResult,
  MlsProperty,
  MlsProvider,
  PropertySearchCriteria,
} from "./types";

/**
 * Local mock MLS.
 *
 * A small, plausible Austin-area inventory used to make comparables, buyer
 * matching and seller updates real before licensed data exists. It is clearly
 * fictional — addresses do not correspond to real properties — and every screen
 * that renders it says the MLS is not connected.
 */
const INVENTORY: MlsProperty[] = [
  // Twin Creeks / Cedar Park 78613 — the competitive set for 2700 Lothian.
  mk("ACT-4471880", "2512 Cypress Club Dr", "Cedar Park", "78613", "Twin Creeks", 925000, "active", 31, { beds: 4, baths: 3, sqft: 3310, pool: true }),
  mk("ACT-4469902", "1904 Ravello Trail", "Cedar Park", "78613", "Twin Creeks", 899000, "active", 58, { beds: 4, baths: 3, sqft: 3120, reduced: 12 }),
  mk("ACT-4472011", "2801 Lorenzo Trail", "Cedar Park", "78613", "Twin Creeks", 975000, "active", 14, { beds: 5, baths: 4, sqft: 3720, pool: true }),
  mk("ACT-4467740", "1620 Twin Creeks Club Dr", "Cedar Park", "78613", "Twin Creeks", 949000, "active", 76, { beds: 4, baths: 4, sqft: 3550, reduced: 26 }),
  mk("ACT-4470993", "2308 Ambling Trail", "Cedar Park", "78613", "Twin Creeks", 869000, "active", 22, { beds: 4, baths: 3, sqft: 2980 }),
  mk("ACT-4468120", "1712 Turnberry Dr", "Cedar Park", "78613", "Twin Creeks", 915000, "active", 41, { beds: 4, baths: 3, sqft: 3240, reduced: 8 }),
  mk("ACT-4466330", "2205 Barolo Ct", "Cedar Park", "78613", "Twin Creeks", 902000, "pending", 24, { beds: 4, baths: 3, sqft: 3180 }),
  mk("ACT-4464411", "1508 Wilkes Way", "Cedar Park", "78613", "Twin Creeks", 938000, "closed", 33, { beds: 4, baths: 3, sqft: 3400, close: 921000, closedDaysAgo: 18 }),
  mk("ACT-4463998", "2604 Renoir Trail", "Cedar Park", "78613", "Twin Creeks", 889000, "closed", 47, { beds: 4, baths: 3, sqft: 3050, close: 872500, closedDaysAgo: 41 }),

  // Bouldin / 78704 — the set for 1800 Brackenridge.
  mk("ACT-4471455", "1611 Newton St", "Austin", "78704", "Bouldin Creek", 1349000, "active", 19, { beds: 3, baths: 2, sqft: 1920, year: 1948 }),
  mk("ACT-4470220", "907 W Mary St", "Austin", "78704", "Bouldin Creek", 1495000, "active", 44, { beds: 4, baths: 3, sqft: 2340, year: 2019 }),
  mk("ACT-4472330", "2104 Wilson St", "Austin", "78704", "Bouldin Creek", 1195000, "active", 8, { beds: 3, baths: 2, sqft: 1640, year: 1941 }),
  mk("ACT-4469005", "1503 Kinney Ave", "Austin", "78704", "Zilker", 1275000, "pending", 12, { beds: 3, baths: 2, sqft: 1810, year: 1952 }),
  mk("ACT-4465512", "1209 Bouldin Ave", "Austin", "78704", "Bouldin Creek", 1310000, "closed", 21, { beds: 3, baths: 2, sqft: 1875, close: 1282000, closedDaysAgo: 27, year: 1939 }),
  mk("ACT-4462201", "701 Christopher St", "Austin", "78704", "Bouldin Creek", 1425000, "closed", 38, { beds: 4, baths: 3, sqft: 2210, close: 1380000, closedDaysAgo: 55, year: 2016 }),

  // Lago Vista 78645 — the set for 2111 American.
  mk("ACT-4470870", "3406 Nautical Dr", "Lago Vista", "78645", "Lago Vista", 649000, "active", 63, { beds: 3, baths: 2, sqft: 2140, reduced: 20 }),
  mk("ACT-4471600", "20805 Lakeland Dr", "Lago Vista", "78645", "Lago Vista", 599000, "active", 29, { beds: 3, baths: 2, sqft: 1980 }),
  mk("ACT-4468899", "7302 Silver Spur", "Lago Vista", "78645", "Lago Vista", 725000, "active", 91, { beds: 4, baths: 3, sqft: 2560, reduced: 35 }),
  mk("ACT-4467105", "4108 Boat Basin", "Lago Vista", "78645", "Lago Vista", 585000, "pending", 37, { beds: 3, baths: 2, sqft: 2020 }),
  mk("ACT-4464880", "21201 Bay Hill", "Lago Vista", "78645", "Lago Vista", 612000, "closed", 52, { beds: 3, baths: 2, sqft: 2180, close: 591000, closedDaysAgo: 33 }),
];

interface MkOpts {
  beds?: number;
  baths?: number;
  sqft?: number;
  year?: number;
  pool?: boolean;
  reduced?: number;
  close?: number;
  closedDaysAgo?: number;
}

function mk(
  mlsNumber: string,
  address: string,
  city: string,
  postalCode: string,
  neighborhood: string,
  listPrice: number,
  status: MlsProperty["status"],
  daysOnMarket: number,
  opts: MkOpts = {},
): MlsProperty {
  return {
    mlsNumber,
    address,
    city,
    postalCode,
    neighborhood,
    listPrice,
    closePrice: opts.close ?? null,
    beds: opts.beds ?? null,
    baths: opts.baths ?? null,
    squareFeet: opts.sqft ?? null,
    lotSizeAcres: null,
    yearBuilt: opts.year ?? null,
    status,
    daysOnMarket,
    listDate: daysBeforeNow(daysOnMarket),
    closeDate: opts.closedDaysAgo !== undefined ? daysBeforeNow(opts.closedDaysAgo) : null,
    priceReducedAt: opts.reduced !== undefined ? daysBeforeNow(opts.reduced) : null,
    originalListPrice: opts.reduced !== undefined ? Math.round(listPrice * 1.06) : listPrice,
    hasPool: opts.pool ?? false,
    stories: null,
  };
}

function matches(p: MlsProperty, c: PropertySearchCriteria) {
  if (c.postalCode && p.postalCode !== c.postalCode) return false;
  if (c.city && p.city.toLowerCase() !== c.city.toLowerCase()) return false;
  if (c.neighborhood && (p.neighborhood ?? "").toLowerCase() !== c.neighborhood.toLowerCase()) return false;
  if (c.priceMin !== undefined && p.listPrice < c.priceMin) return false;
  if (c.priceMax !== undefined && p.listPrice > c.priceMax) return false;
  if (c.beds !== undefined && (p.beds ?? 0) < c.beds) return false;
  if (c.baths !== undefined && (p.baths ?? 0) < c.baths) return false;
  if (c.minSquareFeet !== undefined && (p.squareFeet ?? 0) < c.minSquareFeet) return false;
  if (c.hasPool !== undefined && Boolean(p.hasPool) !== c.hasPool) return false;
  if (c.status && !c.status.includes(p.status)) return false;
  return true;
}

export class MockMlsProvider implements MlsProvider {
  readonly name = "mock";
  readonly mode = "mock" as const;

  async searchProperties(criteria: PropertySearchCriteria): Promise<MlsProperty[]> {
    return INVENTORY.filter((p) => matches(p, criteria)).slice(0, criteria.limit ?? 50);
  }

  async getProperty(mlsNumber: string): Promise<MlsProperty | null> {
    return INVENTORY.find((p) => p.mlsNumber === mlsNumber) ?? null;
  }

  async getComparables(criteria: ComparablesCriteria): Promise<ComparablesResult> {
    const withinDays = criteria.withinDays ?? 90;
    const cutoff = daysBeforeNow(withinDays);
    const pool = INVENTORY.filter((p) => {
      if (p.postalCode !== criteria.postalCode) return false;
      if (criteria.priceMin !== undefined && p.listPrice < criteria.priceMin) return false;
      if (criteria.priceMax !== undefined && p.listPrice > criteria.priceMax) return false;
      return true;
    });
    return {
      actives: pool.filter((p) => p.status === "active"),
      pendings: pool.filter((p) => p.status === "pending"),
      solds: pool.filter((p) => p.status === "closed" && (p.closeDate ?? "") >= cutoff),
      priceReductions: pool.filter((p) => Boolean(p.priceReducedAt) && p.priceReducedAt! >= cutoff),
    };
  }

  async getStatusChanges(sinceIso: string): Promise<MlsProperty[]> {
    return INVENTORY.filter(
      (p) => (p.closeDate ?? p.priceReducedAt ?? p.listDate ?? "") >= sinceIso,
    );
  }

  async getNewListings(criteria: PropertySearchCriteria): Promise<MlsProperty[]> {
    return (await this.searchProperties({ ...criteria, status: ["active", "coming_soon"] }))
      .filter((p) => p.daysOnMarket <= 14)
      .sort((a, b) => a.daysOnMarket - b.daysOnMarket);
  }

  async getPendings(criteria: PropertySearchCriteria): Promise<MlsProperty[]> {
    return this.searchProperties({ ...criteria, status: ["pending"] });
  }

  async getSolds(criteria: PropertySearchCriteria): Promise<MlsProperty[]> {
    return this.searchProperties({ ...criteria, status: ["closed"] });
  }
}
