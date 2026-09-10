/**
 * MLS adapter interface, shaped after the RESO Web API resources.
 *
 * MLS access is licensed. Nothing in this codebase scrapes a portal, and the
 * product does not depend on live MLS data to function — every screen works on
 * manually entered or cached property data. When Unlock MLS access is approved,
 * implement this interface against MLS Grid, Trestle, Bridge Interactive, or
 * any other approved RESO Web API feed and register it in `getMlsProvider()`.
 */

export interface MlsProperty {
  mlsNumber: string;
  address: string;
  city: string;
  postalCode: string;
  neighborhood?: string | null;
  listPrice: number;
  closePrice?: number | null;
  beds?: number | null;
  baths?: number | null;
  squareFeet?: number | null;
  lotSizeAcres?: number | null;
  yearBuilt?: number | null;
  status: "active" | "pending" | "closed" | "coming_soon" | "withdrawn";
  daysOnMarket: number;
  listDate?: string | null;
  closeDate?: string | null;
  priceReducedAt?: string | null;
  originalListPrice?: number | null;
  hasPool?: boolean;
  stories?: number | null;
}

export interface PropertySearchCriteria {
  postalCode?: string;
  city?: string;
  neighborhood?: string;
  priceMin?: number;
  priceMax?: number;
  beds?: number;
  baths?: number;
  minSquareFeet?: number;
  hasPool?: boolean;
  stories?: number;
  status?: MlsProperty["status"][];
  limit?: number;
}

export interface ComparablesCriteria {
  postalCode: string;
  beds?: number;
  priceMin?: number;
  priceMax?: number;
  withinDays?: number;
}

export interface ComparablesResult {
  actives: MlsProperty[];
  pendings: MlsProperty[];
  solds: MlsProperty[];
  priceReductions: MlsProperty[];
}

export interface MlsProvider {
  readonly name: string;
  readonly mode: "mock" | "live";
  searchProperties(criteria: PropertySearchCriteria): Promise<MlsProperty[]>;
  getProperty(mlsNumber: string): Promise<MlsProperty | null>;
  getComparables(criteria: ComparablesCriteria): Promise<ComparablesResult>;
  getStatusChanges(sinceIso: string): Promise<MlsProperty[]>;
  getNewListings(criteria: PropertySearchCriteria): Promise<MlsProperty[]>;
  getPendings(criteria: PropertySearchCriteria): Promise<MlsProperty[]>;
  getSolds(criteria: PropertySearchCriteria): Promise<MlsProperty[]>;
}
