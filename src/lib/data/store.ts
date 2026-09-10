import "server-only";
import { capabilities } from "@/lib/env";
import type {
  AIAction,
  AIRun,
  AppointmentPrep,
  AuditLogEntry,
  BuyerProfile,
  CalendarEvent,
  Contact,
  ContactNote,
  DailyBrief,
  Dataset,
  EmailEvent,
  IntegrationConnection,
  Lead,
  Listing,
  ListingMarketingAsset,
  MarketingAsset,
  Opportunity,
  Profile,
  Property,
  SellerUpdate,
  ShowingFeedback,
  Task,
  Transaction,
  UUID,
} from "@/lib/types";

/**
 * The single seam between the application and its persistence.
 *
 * Every page, workflow, server action and AI tool is written against this
 * interface. `MemoryStore` makes the product demonstrable with no
 * infrastructure; `SupabaseStore` is the real thing. Nothing above this layer
 * knows which one it is talking to.
 */
export interface DataStore {
  readonly kind: "memory" | "supabase";

  /**
   * A consistent snapshot of everything the current user can see. Workflows
   * need broad cross-entity context (a follow-up score reads contacts, email
   * events, notes, tasks and listings at once), and for a two-person brokerage
   * the whole book of business is small enough to load in one go.
   */
  snapshot(): Promise<Dataset>;

  listProfiles(): Promise<Profile[]>;
  getProfile(id: UUID): Promise<Profile | null>;

  listContacts(): Promise<Contact[]>;
  getContact(id: UUID): Promise<Contact | null>;
  updateContact(id: UUID, patch: Partial<Contact>): Promise<Contact>;
  addContactNote(note: Omit<ContactNote, "id" | "createdAt">): Promise<ContactNote>;

  listLeads(): Promise<Lead[]>;
  getLead(id: UUID): Promise<Lead | null>;
  createLead(lead: Omit<Lead, "id" | "createdAt" | "updatedAt">): Promise<Lead>;
  updateLead(id: UUID, patch: Partial<Lead>): Promise<Lead>;

  listProperties(): Promise<Property[]>;
  getProperty(id: UUID): Promise<Property | null>;

  listListings(): Promise<Listing[]>;
  getListing(id: UUID): Promise<Listing | null>;
  updateListing(id: UUID, patch: Partial<Listing>): Promise<Listing>;

  listShowingFeedback(): Promise<ShowingFeedback[]>;

  listSellerUpdates(): Promise<SellerUpdate[]>;
  getSellerUpdate(id: UUID): Promise<SellerUpdate | null>;
  createSellerUpdate(u: Omit<SellerUpdate, "id" | "createdAt" | "updatedAt">): Promise<SellerUpdate>;
  updateSellerUpdate(id: UUID, patch: Partial<SellerUpdate>): Promise<SellerUpdate>;

  listBuyers(): Promise<BuyerProfile[]>;
  getBuyer(id: UUID): Promise<BuyerProfile | null>;
  updateBuyer(id: UUID, patch: Partial<BuyerProfile>): Promise<BuyerProfile>;

  listTransactions(): Promise<Transaction[]>;
  getTransaction(id: UUID): Promise<Transaction | null>;

  listTasks(): Promise<Task[]>;
  createTask(task: Omit<Task, "id" | "createdAt" | "updatedAt">): Promise<Task>;
  updateTask(id: UUID, patch: Partial<Task>): Promise<Task>;

  listCalendarEvents(): Promise<CalendarEvent[]>;
  getCalendarEvent(id: UUID): Promise<CalendarEvent | null>;
  updateCalendarEvent(id: UUID, patch: Partial<CalendarEvent>): Promise<CalendarEvent>;

  listEmailEvents(): Promise<EmailEvent[]>;

  listOpportunities(): Promise<Opportunity[]>;
  getOpportunity(id: UUID): Promise<Opportunity | null>;
  /** Workflows regenerate the open set wholesale; acted/dismissed rows survive. */
  replaceOpenOpportunities(
    ownerId: UUID,
    next: Omit<Opportunity, "id" | "createdAt" | "updatedAt">[],
  ): Promise<Opportunity[]>;
  updateOpportunity(id: UUID, patch: Partial<Opportunity>): Promise<Opportunity>;

  listAIRuns(): Promise<AIRun[]>;
  createAIRun(run: Omit<AIRun, "id" | "createdAt" | "updatedAt">): Promise<AIRun>;

  listAIActions(): Promise<AIAction[]>;
  getAIAction(id: UUID): Promise<AIAction | null>;
  createAIAction(a: Omit<AIAction, "id" | "createdAt" | "updatedAt">): Promise<AIAction>;
  updateAIAction(id: UUID, patch: Partial<AIAction>): Promise<AIAction>;

  listListingMarketing(): Promise<ListingMarketingAsset[]>;
  getListingMarketing(id: UUID): Promise<ListingMarketingAsset | null>;
  createListingMarketing(
    a: Omit<ListingMarketingAsset, "id" | "createdAt" | "updatedAt">,
  ): Promise<ListingMarketingAsset>;
  updateListingMarketing(id: UUID, patch: Partial<ListingMarketingAsset>): Promise<ListingMarketingAsset>;

  listMarketingAssets(): Promise<MarketingAsset[]>;

  getDailyBrief(date: string, ownerId: UUID): Promise<DailyBrief | null>;
  saveDailyBrief(brief: Omit<DailyBrief, "id" | "createdAt" | "updatedAt">): Promise<DailyBrief>;

  getAppointmentPrepFor(eventId: UUID): Promise<AppointmentPrep | null>;
  saveAppointmentPrep(prep: Omit<AppointmentPrep, "id" | "createdAt" | "updatedAt">): Promise<AppointmentPrep>;

  listIntegrations(): Promise<IntegrationConnection[]>;
  updateIntegration(provider: string, patch: Partial<IntegrationConnection>): Promise<IntegrationConnection>;

  listAuditLog(): Promise<AuditLogEntry[]>;
  appendAudit(entry: Omit<AuditLogEntry, "id" | "createdAt" | "updatedAt">): Promise<AuditLogEntry>;
}

let cached: DataStore | null = null;

/**
 * Pick the store for this process. Supabase when configured, otherwise the
 * seeded in-memory store so the product is fully usable before any credential
 * exists. The choice is logged once so it is never a mystery which one is live.
 */
export async function getStore(): Promise<DataStore> {
  if (cached) return cached;
  if (capabilities.supabase) {
    const { SupabaseStore } = await import("./supabase-store");
    cached = new SupabaseStore();
  } else {
    const { MemoryStore } = await import("./memory-store");
    cached = new MemoryStore();
  }
  return cached;
}

/** Test seam — lets unit tests inject a store without touching env. */
export function __setStoreForTests(store: DataStore | null) {
  cached = store;
}
