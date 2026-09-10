import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { recordToRow, rowToRecord } from "./mapping";
import type { DataStore } from "./store";
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
  StatedPlan,
  Task,
  Transaction,
  UUID,
} from "@/lib/types";

const TABLE = {
  profiles: "profiles",
  contacts: "contacts_cache",
  contactNotes: "contact_notes",
  statedPlans: "stated_plans",
  leads: "leads",
  properties: "properties",
  listings: "listings",
  showingFeedback: "showing_feedback",
  sellerUpdates: "seller_updates",
  buyers: "buyers",
  transactions: "transactions",
  tasks: "tasks",
  calendarEvents: "calendar_events_cache",
  emailEvents: "email_events_cache",
  opportunities: "opportunities",
  aiRuns: "ai_runs",
  aiActions: "ai_actions",
  listingMarketing: "listing_marketing",
  marketingAssets: "marketing_assets",
  dailyBriefs: "daily_briefs",
  appointmentPreps: "appointment_preps",
  integrations: "integration_connections",
  auditLog: "audit_log",
} as const;

/**
 * Postgres-backed store. Queries run as the signed-in user, so row level
 * security — not this class — is what actually enforces access.
 */
export class SupabaseStore implements DataStore {
  readonly kind = "supabase" as const;

  private async client(): Promise<SupabaseClient> {
    return getSupabaseServerClient();
  }

  private async selectAll<T>(table: string, orderBy?: string, ascending = false): Promise<T[]> {
    const supabase = await this.client();
    let query = supabase.from(table).select("*");
    if (orderBy) query = query.order(orderBy, { ascending });
    const { data, error } = await query;
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    return (data ?? []).map((row) => rowToRecord<T>(row as Record<string, unknown>));
  }

  private async selectOne<T>(table: string, column: string, value: string): Promise<T | null> {
    const supabase = await this.client();
    const { data, error } = await supabase.from(table).select("*").eq(column, value).maybeSingle();
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    return data ? rowToRecord<T>(data as Record<string, unknown>) : null;
  }

  private async insert<T>(table: string, record: object): Promise<T> {
    const supabase = await this.client();
    const { data, error } = await supabase
      .from(table)
      .insert(recordToRow(record as Record<string, unknown>))
      .select()
      .single();
    if (error) throw new Error(`Failed to insert into ${table}: ${error.message}`);
    return rowToRecord<T>(data as Record<string, unknown>);
  }

  private async update<T>(table: string, id: string, patch: object, column = "id"): Promise<T> {
    const supabase = await this.client();
    const row = recordToRow(patch as Record<string, unknown>);
    delete row.id;
    delete row.created_at;
    const { data, error } = await supabase.from(table).update(row).eq(column, id).select().single();
    if (error) throw new Error(`Failed to update ${table}: ${error.message}`);
    return rowToRecord<T>(data as Record<string, unknown>);
  }

  /** Contacts carry their notes and stated plans; both live in child tables. */
  private async hydrateContacts(contacts: Contact[]): Promise<Contact[]> {
    if (contacts.length === 0) return contacts;
    const [notes, plans] = await Promise.all([
      this.selectAll<ContactNote>(TABLE.contactNotes, "created_at"),
      this.selectAll<StatedPlan>(TABLE.statedPlans, "matures_at", true),
    ]);
    const byContact = <T extends { contactId: UUID }>(rows: T[], id: UUID) => rows.filter((r) => r.contactId === id);
    return contacts.map((c) => ({
      ...c,
      notes: byContact(notes, c.id),
      statedPlans: byContact(plans, c.id),
    }));
  }

  async snapshot(): Promise<Dataset> {
    const [
      profiles,
      rawContacts,
      leads,
      properties,
      listings,
      showingFeedback,
      sellerUpdates,
      buyers,
      transactions,
      tasks,
      calendarEvents,
      emailEvents,
      opportunities,
      aiRuns,
      aiActions,
      listingMarketing,
      marketingAssets,
      dailyBriefs,
      appointmentPreps,
      integrations,
      auditLog,
    ] = await Promise.all([
      this.selectAll<Profile>(TABLE.profiles),
      this.selectAll<Contact>(TABLE.contacts),
      this.selectAll<Lead>(TABLE.leads, "inquired_at"),
      this.selectAll<Property>(TABLE.properties),
      this.selectAll<Listing>(TABLE.listings),
      this.selectAll<ShowingFeedback>(TABLE.showingFeedback, "showing_at"),
      this.selectAll<SellerUpdate>(TABLE.sellerUpdates, "due_at"),
      this.selectAll<BuyerProfile>(TABLE.buyers),
      this.selectAll<Transaction>(TABLE.transactions, "close_date", true),
      this.selectAll<Task>(TABLE.tasks, "due_at", true),
      this.selectAll<CalendarEvent>(TABLE.calendarEvents, "starts_at", true),
      this.selectAll<EmailEvent>(TABLE.emailEvents, "occurred_at"),
      this.selectAll<Opportunity>(TABLE.opportunities, "score"),
      this.selectAll<AIRun>(TABLE.aiRuns, "started_at"),
      this.selectAll<AIAction>(TABLE.aiActions, "created_at"),
      this.selectAll<ListingMarketingAsset>(TABLE.listingMarketing, "created_at"),
      this.selectAll<MarketingAsset>(TABLE.marketingAssets, "sort_order", true),
      this.selectAll<DailyBrief>(TABLE.dailyBriefs, "date"),
      this.selectAll<AppointmentPrep>(TABLE.appointmentPreps, "created_at"),
      this.selectAll<IntegrationConnection>(TABLE.integrations, "provider", true),
      this.selectAll<AuditLogEntry>(TABLE.auditLog, "created_at"),
    ]);
    return {
      profiles,
      contacts: await this.hydrateContacts(rawContacts),
      leads,
      properties,
      listings,
      showingFeedback,
      sellerUpdates,
      buyers,
      transactions,
      tasks,
      calendarEvents,
      emailEvents,
      opportunities,
      aiRuns,
      aiActions,
      listingMarketing,
      marketingAssets,
      dailyBriefs,
      appointmentPreps,
      integrations,
      auditLog,
    };
  }

  listProfiles() {
    return this.selectAll<Profile>(TABLE.profiles);
  }
  getProfile(id: UUID) {
    return this.selectOne<Profile>(TABLE.profiles, "id", id);
  }

  async listContacts() {
    return this.hydrateContacts(await this.selectAll<Contact>(TABLE.contacts));
  }
  async getContact(id: UUID) {
    const contact = await this.selectOne<Contact>(TABLE.contacts, "id", id);
    if (!contact) return null;
    return (await this.hydrateContacts([contact]))[0];
  }
  updateContact(id: UUID, patch: Partial<Contact>) {
    const { notes: _notes, statedPlans: _plans, ...columns } = patch;
    void _notes;
    void _plans;
    return this.update<Contact>(TABLE.contacts, id, columns);
  }
  addContactNote(note: Omit<ContactNote, "id" | "createdAt">) {
    return this.insert<ContactNote>(TABLE.contactNotes, note);
  }

  listLeads() {
    return this.selectAll<Lead>(TABLE.leads, "inquired_at");
  }
  getLead(id: UUID) {
    return this.selectOne<Lead>(TABLE.leads, "id", id);
  }
  createLead(lead: Omit<Lead, "id" | "createdAt" | "updatedAt">) {
    return this.insert<Lead>(TABLE.leads, lead);
  }
  updateLead(id: UUID, patch: Partial<Lead>) {
    return this.update<Lead>(TABLE.leads, id, patch);
  }

  listProperties() {
    return this.selectAll<Property>(TABLE.properties);
  }
  getProperty(id: UUID) {
    return this.selectOne<Property>(TABLE.properties, "id", id);
  }

  listListings() {
    return this.selectAll<Listing>(TABLE.listings);
  }
  getListing(id: UUID) {
    return this.selectOne<Listing>(TABLE.listings, "id", id);
  }
  updateListing(id: UUID, patch: Partial<Listing>) {
    return this.update<Listing>(TABLE.listings, id, patch);
  }

  listShowingFeedback() {
    return this.selectAll<ShowingFeedback>(TABLE.showingFeedback, "showing_at");
  }

  listSellerUpdates() {
    return this.selectAll<SellerUpdate>(TABLE.sellerUpdates, "due_at");
  }
  getSellerUpdate(id: UUID) {
    return this.selectOne<SellerUpdate>(TABLE.sellerUpdates, "id", id);
  }
  createSellerUpdate(u: Omit<SellerUpdate, "id" | "createdAt" | "updatedAt">) {
    return this.insert<SellerUpdate>(TABLE.sellerUpdates, u);
  }
  updateSellerUpdate(id: UUID, patch: Partial<SellerUpdate>) {
    return this.update<SellerUpdate>(TABLE.sellerUpdates, id, patch);
  }

  listBuyers() {
    return this.selectAll<BuyerProfile>(TABLE.buyers);
  }
  getBuyer(id: UUID) {
    return this.selectOne<BuyerProfile>(TABLE.buyers, "id", id);
  }
  updateBuyer(id: UUID, patch: Partial<BuyerProfile>) {
    return this.update<BuyerProfile>(TABLE.buyers, id, patch);
  }

  listTransactions() {
    return this.selectAll<Transaction>(TABLE.transactions, "close_date", true);
  }
  getTransaction(id: UUID) {
    return this.selectOne<Transaction>(TABLE.transactions, "id", id);
  }
  async updateTransactionMilestone(id: UUID, label: string, complete: boolean) {
    const transaction = await this.getTransaction(id);
    if (!transaction) throw new Error(`Transaction ${id} not found`);
    return this.update<Transaction>(TABLE.transactions, id, {
      milestones: transaction.milestones.map((m) => (m.label === label ? { ...m, complete } : m)),
    });
  }

  listTasks() {
    return this.selectAll<Task>(TABLE.tasks, "due_at", true);
  }
  createTask(task: Omit<Task, "id" | "createdAt" | "updatedAt">) {
    return this.insert<Task>(TABLE.tasks, task);
  }
  updateTask(id: UUID, patch: Partial<Task>) {
    return this.update<Task>(TABLE.tasks, id, patch);
  }

  listCalendarEvents() {
    return this.selectAll<CalendarEvent>(TABLE.calendarEvents, "starts_at", true);
  }
  getCalendarEvent(id: UUID) {
    return this.selectOne<CalendarEvent>(TABLE.calendarEvents, "id", id);
  }
  updateCalendarEvent(id: UUID, patch: Partial<CalendarEvent>) {
    return this.update<CalendarEvent>(TABLE.calendarEvents, id, patch);
  }

  listEmailEvents() {
    return this.selectAll<EmailEvent>(TABLE.emailEvents, "occurred_at");
  }

  listOpportunities() {
    return this.selectAll<Opportunity>(TABLE.opportunities, "score");
  }
  getOpportunity(id: UUID) {
    return this.selectOne<Opportunity>(TABLE.opportunities, "id", id);
  }
  async replaceOpenOpportunities(
    ownerId: UUID,
    next: Omit<Opportunity, "id" | "createdAt" | "updatedAt">[],
  ): Promise<Opportunity[]> {
    const supabase = await this.client();
    // Only regenerate the open set. Acted and dismissed rows are Jamie's record
    // of what she decided and must survive a rerun.
    const { error: deleteError } = await supabase
      .from(TABLE.opportunities)
      .delete()
      .eq("owner_id", ownerId)
      .eq("status", "open");
    if (deleteError) throw new Error(`Failed to clear opportunities: ${deleteError.message}`);
    if (next.length === 0) return [];
    const { data, error } = await supabase
      .from(TABLE.opportunities)
      .insert(next.map((o) => recordToRow(o as unknown as Record<string, unknown>)))
      .select();
    if (error) throw new Error(`Failed to write opportunities: ${error.message}`);
    return (data ?? []).map((row) => rowToRecord<Opportunity>(row as Record<string, unknown>));
  }
  updateOpportunity(id: UUID, patch: Partial<Opportunity>) {
    return this.update<Opportunity>(TABLE.opportunities, id, patch);
  }

  listAIRuns() {
    return this.selectAll<AIRun>(TABLE.aiRuns, "started_at");
  }
  createAIRun(run: Omit<AIRun, "id" | "createdAt" | "updatedAt">) {
    return this.insert<AIRun>(TABLE.aiRuns, run);
  }

  listAIActions() {
    return this.selectAll<AIAction>(TABLE.aiActions, "created_at");
  }
  getAIAction(id: UUID) {
    return this.selectOne<AIAction>(TABLE.aiActions, "id", id);
  }
  createAIAction(a: Omit<AIAction, "id" | "createdAt" | "updatedAt">) {
    return this.insert<AIAction>(TABLE.aiActions, a);
  }
  updateAIAction(id: UUID, patch: Partial<AIAction>) {
    return this.update<AIAction>(TABLE.aiActions, id, patch);
  }

  listListingMarketing() {
    return this.selectAll<ListingMarketingAsset>(TABLE.listingMarketing, "created_at");
  }
  getListingMarketing(id: UUID) {
    return this.selectOne<ListingMarketingAsset>(TABLE.listingMarketing, "id", id);
  }
  createListingMarketing(a: Omit<ListingMarketingAsset, "id" | "createdAt" | "updatedAt">) {
    return this.insert<ListingMarketingAsset>(TABLE.listingMarketing, a);
  }
  updateListingMarketing(id: UUID, patch: Partial<ListingMarketingAsset>) {
    return this.update<ListingMarketingAsset>(TABLE.listingMarketing, id, patch);
  }

  listMarketingAssets() {
    return this.selectAll<MarketingAsset>(TABLE.marketingAssets, "sort_order", true);
  }

  async getDailyBrief(date: string, ownerId: UUID) {
    const supabase = await this.client();
    const { data, error } = await supabase
      .from(TABLE.dailyBriefs)
      .select("*")
      .eq("date", date)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) throw new Error(`Failed to read daily brief: ${error.message}`);
    return data ? rowToRecord<DailyBrief>(data as Record<string, unknown>) : null;
  }
  async saveDailyBrief(brief: Omit<DailyBrief, "id" | "createdAt" | "updatedAt">) {
    const supabase = await this.client();
    const { data, error } = await supabase
      .from(TABLE.dailyBriefs)
      .upsert(recordToRow(brief as unknown as Record<string, unknown>), { onConflict: "date,owner_id" })
      .select()
      .single();
    if (error) throw new Error(`Failed to save daily brief: ${error.message}`);
    return rowToRecord<DailyBrief>(data as Record<string, unknown>);
  }

  getAppointmentPrepFor(eventId: UUID) {
    return this.selectOne<AppointmentPrep>(TABLE.appointmentPreps, "calendar_event_id", eventId);
  }
  async saveAppointmentPrep(prep: Omit<AppointmentPrep, "id" | "createdAt" | "updatedAt">) {
    const existing = await this.getAppointmentPrepFor(prep.calendarEventId);
    if (existing) return this.update<AppointmentPrep>(TABLE.appointmentPreps, existing.id, prep);
    return this.insert<AppointmentPrep>(TABLE.appointmentPreps, prep);
  }

  listIntegrations() {
    return this.selectAll<IntegrationConnection>(TABLE.integrations, "provider", true);
  }
  updateIntegration(provider: string, patch: Partial<IntegrationConnection>) {
    return this.update<IntegrationConnection>(TABLE.integrations, provider, patch, "provider");
  }

  listAuditLog() {
    return this.selectAll<AuditLogEntry>(TABLE.auditLog, "created_at");
  }
  appendAudit(entry: Omit<AuditLogEntry, "id" | "createdAt" | "updatedAt">) {
    return this.insert<AuditLogEntry>(TABLE.auditLog, entry);
  }
}
