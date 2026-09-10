import "server-only";
import { randomUUID } from "node:crypto";
import type { DataStore } from "./store";
import { buildSeedDataset } from "./seed";
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
 * In-memory store backed by the seed dataset.
 *
 * State lives for the lifetime of the Node process. That is the right trade for
 * a demo — Jamie can create tasks, approve drafts and work the queue, and a
 * restart puts the demo back to a known state. Connect Supabase for durability.
 *
 * The dataset is held on `globalThis` so Next.js dev-mode module reloads do not
 * silently reset Jamie's work mid-session.
 */
const GLOBAL_KEY = Symbol.for("residential-os.memory-dataset");

type GlobalWithDataset = typeof globalThis & { [GLOBAL_KEY]?: Dataset };

function dataset(): Dataset {
  const g = globalThis as GlobalWithDataset;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = buildSeedDataset();
  return g[GLOBAL_KEY];
}

function stamp<T extends object>(value: T) {
  const ts = new Date().toISOString();
  return { ...value, id: randomUUID(), createdAt: ts, updatedAt: ts };
}

function patchRow<T extends { id: UUID; updatedAt: string }>(rows: T[], id: UUID, patch: Partial<T>, label: string): T {
  const index = rows.findIndex((r) => r.id === id);
  if (index === -1) throw new Error(`${label} ${id} not found`);
  const next = { ...rows[index], ...patch, id, updatedAt: new Date().toISOString() };
  rows[index] = next;
  return next;
}

export class MemoryStore implements DataStore {
  readonly kind = "memory" as const;

  async snapshot(): Promise<Dataset> {
    return dataset();
  }

  async listProfiles(): Promise<Profile[]> {
    return dataset().profiles;
  }
  async getProfile(id: UUID) {
    return dataset().profiles.find((p) => p.id === id) ?? null;
  }

  async listContacts(): Promise<Contact[]> {
    return dataset().contacts;
  }
  async getContact(id: UUID) {
    return dataset().contacts.find((c) => c.id === id) ?? null;
  }
  async updateContact(id: UUID, patch: Partial<Contact>) {
    return patchRow(dataset().contacts, id, patch, "Contact");
  }
  async addContactNote(note: Omit<ContactNote, "id" | "createdAt">): Promise<ContactNote> {
    const contact = dataset().contacts.find((c) => c.id === note.contactId);
    if (!contact) throw new Error(`Contact ${note.contactId} not found`);
    const created: ContactNote = { ...note, id: randomUUID(), createdAt: new Date().toISOString() };
    contact.notes = [created, ...contact.notes];
    contact.updatedAt = created.createdAt;
    return created;
  }

  async listLeads(): Promise<Lead[]> {
    return dataset().leads;
  }
  async getLead(id: UUID) {
    return dataset().leads.find((l) => l.id === id) ?? null;
  }
  async createLead(lead: Omit<Lead, "id" | "createdAt" | "updatedAt">) {
    const created = stamp(lead) as Lead;
    dataset().leads.unshift(created);
    return created;
  }
  async updateLead(id: UUID, patch: Partial<Lead>) {
    return patchRow(dataset().leads, id, patch, "Lead");
  }

  async listProperties(): Promise<Property[]> {
    return dataset().properties;
  }
  async getProperty(id: UUID) {
    return dataset().properties.find((p) => p.id === id) ?? null;
  }

  async listListings(): Promise<Listing[]> {
    return dataset().listings;
  }
  async getListing(id: UUID) {
    return dataset().listings.find((l) => l.id === id) ?? null;
  }
  async updateListing(id: UUID, patch: Partial<Listing>) {
    return patchRow(dataset().listings, id, patch, "Listing");
  }

  async listShowingFeedback(): Promise<ShowingFeedback[]> {
    return dataset().showingFeedback;
  }

  async listSellerUpdates(): Promise<SellerUpdate[]> {
    return dataset().sellerUpdates;
  }
  async getSellerUpdate(id: UUID) {
    return dataset().sellerUpdates.find((s) => s.id === id) ?? null;
  }
  async createSellerUpdate(u: Omit<SellerUpdate, "id" | "createdAt" | "updatedAt">) {
    const created = stamp(u) as SellerUpdate;
    dataset().sellerUpdates.unshift(created);
    return created;
  }
  async updateSellerUpdate(id: UUID, patch: Partial<SellerUpdate>) {
    return patchRow(dataset().sellerUpdates, id, patch, "Seller update");
  }

  async listBuyers(): Promise<BuyerProfile[]> {
    return dataset().buyers;
  }
  async getBuyer(id: UUID) {
    return dataset().buyers.find((b) => b.id === id) ?? null;
  }
  async updateBuyer(id: UUID, patch: Partial<BuyerProfile>) {
    return patchRow(dataset().buyers, id, patch, "Buyer");
  }

  async listTransactions(): Promise<Transaction[]> {
    return dataset().transactions;
  }
  async getTransaction(id: UUID) {
    return dataset().transactions.find((t) => t.id === id) ?? null;
  }

  async listTasks(): Promise<Task[]> {
    return dataset().tasks;
  }
  async createTask(task: Omit<Task, "id" | "createdAt" | "updatedAt">) {
    const created = stamp(task) as Task;
    dataset().tasks.unshift(created);
    return created;
  }
  async updateTask(id: UUID, patch: Partial<Task>) {
    return patchRow(dataset().tasks, id, patch, "Task");
  }

  async listCalendarEvents(): Promise<CalendarEvent[]> {
    return dataset().calendarEvents;
  }
  async getCalendarEvent(id: UUID) {
    return dataset().calendarEvents.find((e) => e.id === id) ?? null;
  }
  async updateCalendarEvent(id: UUID, patch: Partial<CalendarEvent>) {
    return patchRow(dataset().calendarEvents, id, patch, "Calendar event");
  }

  async listEmailEvents(): Promise<EmailEvent[]> {
    return dataset().emailEvents;
  }

  async listOpportunities(): Promise<Opportunity[]> {
    return dataset().opportunities;
  }
  async getOpportunity(id: UUID) {
    return dataset().opportunities.find((o) => o.id === id) ?? null;
  }
  async replaceOpenOpportunities(
    ownerId: UUID,
    next: Omit<Opportunity, "id" | "createdAt" | "updatedAt">[],
  ): Promise<Opportunity[]> {
    const d = dataset();
    // Anything Jamie has already acted on or dismissed is hers, not the model's.
    const retained = d.opportunities.filter((o) => o.ownerId !== ownerId || o.status !== "open");
    const dismissedKeys = new Set(
      retained.filter((o) => o.status !== "open").map((o) => `${o.kind}:${o.contactId ?? o.listingId}`),
    );
    const created = next
      .filter((o) => !dismissedKeys.has(`${o.kind}:${o.contactId ?? o.listingId}`))
      .map((o) => stamp(o) as Opportunity);
    d.opportunities = [...retained, ...created];
    return created;
  }
  async updateOpportunity(id: UUID, patch: Partial<Opportunity>) {
    return patchRow(dataset().opportunities, id, patch, "Opportunity");
  }

  async listAIRuns(): Promise<AIRun[]> {
    return dataset().aiRuns;
  }
  async createAIRun(run: Omit<AIRun, "id" | "createdAt" | "updatedAt">) {
    const created = stamp(run) as AIRun;
    dataset().aiRuns.unshift(created);
    // Keep the audit list bounded in a long-running demo process.
    if (dataset().aiRuns.length > 500) dataset().aiRuns.length = 500;
    return created;
  }

  async listAIActions(): Promise<AIAction[]> {
    return dataset().aiActions;
  }
  async getAIAction(id: UUID) {
    return dataset().aiActions.find((a) => a.id === id) ?? null;
  }
  async createAIAction(a: Omit<AIAction, "id" | "createdAt" | "updatedAt">) {
    const created = stamp(a) as AIAction;
    dataset().aiActions.unshift(created);
    return created;
  }
  async updateAIAction(id: UUID, patch: Partial<AIAction>) {
    return patchRow(dataset().aiActions, id, patch, "AI action");
  }

  async listListingMarketing(): Promise<ListingMarketingAsset[]> {
    return dataset().listingMarketing;
  }
  async getListingMarketing(id: UUID) {
    return dataset().listingMarketing.find((m) => m.id === id) ?? null;
  }
  async createListingMarketing(a: Omit<ListingMarketingAsset, "id" | "createdAt" | "updatedAt">) {
    const created = stamp(a) as ListingMarketingAsset;
    dataset().listingMarketing.unshift(created);
    return created;
  }
  async updateListingMarketing(id: UUID, patch: Partial<ListingMarketingAsset>) {
    return patchRow(dataset().listingMarketing, id, patch, "Marketing content");
  }

  async listMarketingAssets(): Promise<MarketingAsset[]> {
    return dataset().marketingAssets;
  }

  async getDailyBrief(date: string, ownerId: UUID) {
    return dataset().dailyBriefs.find((b) => b.date === date && b.ownerId === ownerId) ?? null;
  }
  async saveDailyBrief(brief: Omit<DailyBrief, "id" | "createdAt" | "updatedAt">) {
    const d = dataset();
    const existing = d.dailyBriefs.find((b) => b.date === brief.date && b.ownerId === brief.ownerId);
    if (existing) return patchRow(d.dailyBriefs, existing.id, brief as Partial<DailyBrief>, "Daily brief");
    const created = stamp(brief) as DailyBrief;
    d.dailyBriefs.unshift(created);
    return created;
  }

  async getAppointmentPrepFor(eventId: UUID) {
    return dataset().appointmentPreps.find((p) => p.calendarEventId === eventId) ?? null;
  }
  async saveAppointmentPrep(prep: Omit<AppointmentPrep, "id" | "createdAt" | "updatedAt">) {
    const d = dataset();
    const existing = d.appointmentPreps.find((p) => p.calendarEventId === prep.calendarEventId);
    if (existing) return patchRow(d.appointmentPreps, existing.id, prep as Partial<AppointmentPrep>, "Prep");
    const created = stamp(prep) as AppointmentPrep;
    d.appointmentPreps.unshift(created);
    return created;
  }

  async listIntegrations(): Promise<IntegrationConnection[]> {
    return dataset().integrations;
  }
  async updateIntegration(provider: string, patch: Partial<IntegrationConnection>) {
    const d = dataset();
    const existing = d.integrations.find((i) => i.provider === provider);
    if (!existing) throw new Error(`Integration ${provider} not found`);
    return patchRow(d.integrations, existing.id, patch, "Integration");
  }

  async listAuditLog(): Promise<AuditLogEntry[]> {
    return dataset().auditLog;
  }
  async appendAudit(entry: Omit<AuditLogEntry, "id" | "createdAt" | "updatedAt">) {
    const created = stamp(entry) as AuditLogEntry;
    dataset().auditLog.unshift(created);
    if (dataset().auditLog.length > 1000) dataset().auditLog.length = 1000;
    return created;
  }
}
