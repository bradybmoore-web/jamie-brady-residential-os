/**
 * Domain model for the Residential OS.
 *
 * These types mirror the Supabase schema in `supabase/migrations/0001_init.sql`
 * one-for-one (snake_case columns map to camelCase fields in the store layer).
 * Every record carries `sourceSystem` / `sourceId` so a row can always be traced
 * back to Cloze, Gmail, the MLS, or a manual entry.
 */

export type UUID = string;
export type ISODate = string;

export type SourceSystem =
  | "manual"
  | "seed"
  | "cloze"
  | "gmail"
  | "google_calendar"
  | "activepipe"
  | "mls"
  | "zapier"
  | "ai";

export interface BaseRecord {
  id: UUID;
  createdAt: ISODate;
  updatedAt: ISODate;
  sourceSystem: SourceSystem;
  sourceId?: string | null;
  /** Seed rows are demo data and are labelled as such everywhere in the UI. */
  isSeed?: boolean;
}

/* ------------------------------------------------------------------ people */

export type ContactType =
  | "lead"
  | "active_buyer"
  | "active_seller"
  | "past_client"
  | "sphere"
  | "agent"
  | "vendor";

export type ContactStage =
  | "new"
  | "nurture"
  | "active"
  | "under_contract"
  | "closed"
  | "dormant";

export interface Contact extends BaseRecord {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  type: ContactType;
  stage: ContactStage;
  ownerId: UUID;
  tags: string[];
  city?: string | null;
  neighborhood?: string | null;
  /** Free-text relationship context; the AI is only allowed to cite this. */
  notes: ContactNote[];
  statedPlans: StatedPlan[];
  lastPersonalContactAt?: ISODate | null;
  lastPersonalContactChannel?: "call" | "text" | "email" | "in_person" | null;
  lastTouchAt?: ISODate | null;
  anniversaryAt?: ISODate | null;
  homePurchaseDate?: ISODate | null;
  homeAddress?: string | null;
  clozeId?: string | null;
  doNotContact?: boolean;
}

export interface ContactNote {
  id: UUID;
  contactId: UUID;
  authorId: UUID;
  body: string;
  createdAt: ISODate;
  sourceSystem: SourceSystem;
}

/** Something the person said they intend to do, with a date it becomes relevant. */
export interface StatedPlan {
  id: UUID;
  contactId: UUID;
  statement: string;
  statedAt: ISODate;
  /** When this plan should resurface. */
  maturesAt: ISODate;
  status: "open" | "acted" | "dismissed";
  sourceSystem: SourceSystem;
  sourceId?: string | null;
}

/* ------------------------------------------------------------------- leads */

export type LeadStage =
  | "new"
  | "attempted_contact"
  | "connected"
  | "nurture"
  | "active_buyer"
  | "active_seller"
  | "appointment_set"
  | "converted"
  | "closed"
  | "lost";

export const LEAD_STAGES: LeadStage[] = [
  "new",
  "attempted_contact",
  "connected",
  "nurture",
  "active_buyer",
  "active_seller",
  "appointment_set",
  "converted",
  "closed",
  "lost",
];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  attempted_contact: "Attempted Contact",
  connected: "Connected",
  nurture: "Nurture",
  active_buyer: "Active Buyer",
  active_seller: "Active Seller",
  appointment_set: "Appointment Set",
  converted: "Converted",
  closed: "Closed",
  lost: "Lost",
};

export type LeadType = "buyer" | "seller" | "investor" | "renter" | "unknown";
export type Urgency = "low" | "medium" | "high" | "critical";

export const URGENCY_RANK: Record<Urgency, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

export interface Lead extends BaseRecord {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  source: string;
  inquiredAt: ISODate;
  inquiryContent: string;
  type: LeadType;
  propertyAddress?: string | null;
  desiredArea?: string | null;
  priceRangeMin?: number | null;
  priceRangeMax?: number | null;
  estimatedTimeline?: string | null;
  urgency: Urgency;
  score: number;
  assignedTo: UUID;
  stage: LeadStage;
  aiSummary?: string | null;
  aiRecommendedAction?: string | null;
  draftedResponse?: string | null;
  clozeId?: string | null;
  contactId?: UUID | null;
  lastAttemptAt?: ISODate | null;
  attemptCount: number;
  followUpDueAt?: ISODate | null;
  analysisRunId?: UUID | null;
}

/* -------------------------------------------------------------- properties */

export type PropertyType =
  | "single_family"
  | "condo"
  | "townhome"
  | "lot"
  | "multi_family"
  | "ranch";

export interface Property extends BaseRecord {
  address: string;
  city: string;
  state: string;
  postalCode: string;
  neighborhood?: string | null;
  county?: string | null;
  beds?: number | null;
  baths?: number | null;
  halfBaths?: number | null;
  squareFeet?: number | null;
  lotSizeAcres?: number | null;
  yearBuilt?: number | null;
  propertyType: PropertyType;
  mlsNumber?: string | null;
  subdivision?: string | null;
  schoolDistrict?: string | null;
  elementarySchool?: string | null;
  middleSchool?: string | null;
  highSchool?: string | null;
  hasPool?: boolean;
  stories?: number | null;
  imageUrls: string[];
  latitude?: number | null;
  longitude?: number | null;
}

/* ---------------------------------------------------------------- listings */

export type ListingStatus =
  | "pre_listing"
  | "coming_soon"
  | "active"
  | "price_change"
  | "pending"
  | "closed"
  | "withdrawn";

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  pre_listing: "Pre-Listing",
  coming_soon: "Coming Soon",
  active: "Active",
  price_change: "Price Change",
  pending: "Pending",
  closed: "Closed",
  withdrawn: "Withdrawn",
};

export interface Listing extends BaseRecord {
  propertyId: UUID;
  status: ListingStatus;
  listPrice: number;
  originalListPrice: number;
  listedAt?: ISODate | null;
  launchDate?: ISODate | null;
  contractDate?: ISODate | null;
  closeDate?: ISODate | null;
  ownerId: UUID;
  sellerContactIds: UUID[];
  sellerNames: string;
  openHouseDates: ISODate[];
  majorFeatures: string[];
  improvements: string[];
  neighborhoodAmenities: string[];
  lifestylePoints: string[];
  nearbyDestinations: string[];
  positioning: string;
  writingNotes: string;
  prohibitedPhrases: string[];
  brokerageDisclaimer: string;
  sellerUpdateCadenceDays: number;
  lastSellerUpdateAt?: ISODate | null;
  showingsThisWeek: number;
  totalShowings: number;
  inquiriesThisWeek: number;
  portalViewsThisWeek: number;
  savesThisWeek: number;
  lastActivityAt?: ISODate | null;
  lastActivitySummary?: string | null;
}

export interface ShowingFeedback extends BaseRecord {
  listingId: UUID;
  showingAt: ISODate;
  agentName: string;
  buyerImpression: "positive" | "neutral" | "negative";
  priceReaction: "under" | "fair" | "over" | "unstated";
  comments: string;
}

/* ------------------------------------------------------------ seller updates */

export interface SellerUpdateMarketContext {
  competingActives: number;
  competingPriceReductions: number;
  newPendings: number;
  recentSolds: number;
  medianCompetingPrice?: number | null;
  daysOnMarket: number;
}

export type ApprovalStatus = "draft" | "needs_review" | "approved" | "executed" | "rejected";

export interface SellerUpdate extends BaseRecord {
  listingId: UUID;
  periodStart: ISODate;
  periodEnd: ISODate;
  dueAt: ISODate;
  status: ApprovalStatus;
  facts: string[];
  marketInterpretation: string;
  recommendedAction: string;
  draftMessage: string;
  marketContext: SellerUpdateMarketContext;
  feedbackIds: UUID[];
  aiRunId?: UUID | null;
  approvedBy?: UUID | null;
  approvedAt?: ISODate | null;
}

/* ------------------------------------------------------------------ buyers */

export interface BuyerProfile extends BaseRecord {
  contactId: UUID;
  ownerId: UUID;
  active: boolean;
  targetLocations: string[];
  priceMin: number;
  priceMax: number;
  minBeds: number;
  minBaths: number;
  preferredSquareFeet?: number | null;
  lotPreference?: string | null;
  poolPreference: "required" | "preferred" | "neutral" | "avoid";
  viewPreference?: string | null;
  privacyPreference?: string | null;
  architecturalStyles: string[];
  schools: string[];
  commuteNotes?: string | null;
  primaryBedroomPreference?: string | null;
  oneStoryPreference: "required" | "preferred" | "neutral" | "no";
  dealBreakers: string[];
  mustHaves: string[];
  niceToHaves: string[];
  emotionalReactions: string[];
  preferredPropertyIds: UUID[];
  rejectedPropertyIds: UUID[];
  rejectionReasons: { propertyId: UUID; reason: string }[];
  preApproved: boolean;
  lenderName?: string | null;
  timeline?: string | null;
  lastShowingAt?: ISODate | null;
}

/* ------------------------------------------------------------ transactions */

export type TransactionSide = "listing" | "buyer" | "dual";
export type TransactionStatus =
  | "under_contract"
  | "option_period"
  | "financing"
  | "clear_to_close"
  | "closed"
  | "terminated";

export interface Transaction extends BaseRecord {
  listingId?: UUID | null;
  propertyId: UUID;
  side: TransactionSide;
  status: TransactionStatus;
  clientContactIds: UUID[];
  ownerId: UUID;
  contractPrice: number;
  contractDate: ISODate;
  optionEndsAt?: ISODate | null;
  financingDeadlineAt?: ISODate | null;
  appraisalDueAt?: ISODate | null;
  closeDate: ISODate;
  titleCompany?: string | null;
  lender?: string | null;
  milestones: { label: string; dueAt: ISODate; complete: boolean }[];
}

/* ------------------------------------------------------------------- tasks */

export type TaskStatus = "open" | "done" | "snoozed" | "cancelled";
export type TaskCategory =
  | "follow_up"
  | "marketing"
  | "seller_update"
  | "showing_feedback"
  | "transaction"
  | "admin"
  | "prospecting";

export interface Task extends BaseRecord {
  title: string;
  detail?: string | null;
  category: TaskCategory;
  status: TaskStatus;
  dueAt: ISODate;
  completedAt?: ISODate | null;
  ownerId: UUID;
  contactId?: UUID | null;
  leadId?: UUID | null;
  listingId?: UUID | null;
  transactionId?: UUID | null;
  urgency: Urgency;
  createdByAi: boolean;
  aiRunId?: UUID | null;
}

/* ---------------------------------------------------------------- calendar */

export type AppointmentType =
  | "listing_appointment"
  | "showing"
  | "buyer_consult"
  | "closing"
  | "open_house"
  | "inspection"
  | "photography"
  | "internal"
  | "personal";

export interface CalendarEvent extends BaseRecord {
  title: string;
  type: AppointmentType;
  startsAt: ISODate;
  endsAt: ISODate;
  location?: string | null;
  ownerId: UUID;
  contactIds: UUID[];
  listingId?: UUID | null;
  propertyId?: UUID | null;
  notes?: string | null;
  prepStatus: "not_started" | "prepared" | "not_needed";
  prepBriefId?: UUID | null;
}

/* ------------------------------------------------------------------- email */

export type EmailEngagementType =
  | "email_open"
  | "email_click"
  | "campaign_response"
  | "property_click"
  | "email_received"
  | "email_sent";

export interface EmailEvent extends BaseRecord {
  contactId?: UUID | null;
  contactEmail: string;
  type: EmailEngagementType;
  occurredAt: ISODate;
  subject?: string | null;
  campaignName?: string | null;
  propertyAddress?: string | null;
  threadId?: string | null;
  /** True when the message is inbound and nobody has replied yet. */
  awaitingReply?: boolean;
  snippet?: string | null;
}

/* ----------------------------------------------------------- opportunities */

export type OpportunityKind =
  | "relationship"
  | "buyer_match"
  | "seller_signal"
  | "listing_action"
  | "database_mining";

export type Channel = "call" | "text" | "email" | "in_person" | "handwritten_note";

export interface Opportunity extends BaseRecord {
  kind: OpportunityKind;
  contactId?: UUID | null;
  listingId?: UUID | null;
  ownerId: UUID;
  title: string;
  whyNow: string;
  supportingEvidence: Evidence[];
  recommendedChannel: Channel;
  recommendedAction: string;
  suggestedConversationStarter: string;
  confidence: number;
  score: number;
  urgency: Urgency;
  status: "open" | "acted" | "dismissed" | "snoozed";
  snoozedUntil?: ISODate | null;
  aiRunId?: UUID | null;
}

/**
 * A single grounded fact. `recordType`/`recordId` must point at a record that
 * was actually supplied to the workflow — see `groundEvidence()`.
 */
export interface Evidence {
  label: string;
  detail: string;
  recordType:
    | "contact"
    | "lead"
    | "listing"
    | "task"
    | "email_event"
    | "calendar_event"
    | "note"
    | "stated_plan"
    | "showing_feedback"
    | "transaction"
    | "buyer_profile";
  recordId: UUID;
  occurredAt?: ISODate | null;
}

/* --------------------------------------------------------------- ai audit */

export type AIWorkflowName =
  | "daily_command_center"
  | "analyze_lead"
  | "identify_follow_up_opportunities"
  | "listing_marketing"
  | "seller_update"
  | "appointment_prep"
  | "assistant";

export interface AIRun extends BaseRecord {
  workflow: AIWorkflowName;
  promptVersion: string;
  model: string;
  provider: "anthropic" | "mock";
  inputRecordIds: { recordType: string; recordId: UUID }[];
  status: "success" | "error";
  latencyMs: number;
  tokensIn?: number | null;
  tokensOut?: number | null;
  error?: string | null;
  outputSummary: string;
  startedAt: ISODate;
  ownerId: UUID;
}

export type AIActionType =
  | "email_draft"
  | "text_draft"
  | "task_suggestion"
  | "marketing_content"
  | "seller_update"
  | "stage_change"
  | "note";

export interface AIAction extends BaseRecord {
  aiRunId: UUID;
  workflow: AIWorkflowName;
  type: AIActionType;
  status: ApprovalStatus;
  title: string;
  body: string;
  /** Populated for email drafts. */
  subject?: string | null;
  recipient?: string | null;
  contactId?: UUID | null;
  leadId?: UUID | null;
  listingId?: UUID | null;
  confidence: number;
  evidence: Evidence[];
  ownerId: UUID;
  reviewedBy?: UUID | null;
  reviewedAt?: ISODate | null;
  executedAt?: ISODate | null;
  rejectionReason?: string | null;
  /** True when this action may never be auto-executed without a human. */
  requiresApproval: boolean;
}

/* ------------------------------------------------------- listing marketing */

export type MarketingAssetKind =
  | "mls_description"
  | "instagram_caption"
  | "facebook_caption"
  | "reel_caption"
  | "video_script_30"
  | "video_script_60"
  | "agent_email"
  | "database_email"
  | "neighbor_email"
  | "coming_soon_post"
  | "open_house_post"
  | "price_adjustment_post"
  | "pending_post"
  | "just_sold_post"
  | "feature_captions"
  | "hashtags";

export interface ListingMarketingAsset extends BaseRecord {
  listingId: UUID;
  kind: MarketingAssetKind;
  status: ApprovalStatus;
  content: string;
  promptVersion: string;
  aiRunId?: UUID | null;
  ownerId: UUID;
  approvedAt?: ISODate | null;
  /** Phrases from the banned list that the generator caught and rewrote. */
  flaggedPhrases: string[];
}

/* ---------------------------------------------------------- daily briefing */

export interface DailyBrief extends BaseRecord {
  date: string;
  ownerId: UUID;
  topPriorities: Priority[];
  peopleNeedingAttention: Priority[];
  appointments: UUID[];
  leads: UUID[];
  listingActions: ListingAction[];
  sellerUpdates: UUID[];
  opportunities: UUID[];
  warnings: string[];
  metrics: DailyMetrics;
  aiRunId?: UUID | null;
}

export interface DailyMetrics {
  tasksDue: number;
  newLeads: number;
  followUpsOverdue: number;
  appointmentsToday: number;
  sellerReportsDue: number;
  marketingTasksDue: number;
}

export interface Priority {
  id: UUID;
  title: string;
  personId?: UUID | null;
  personName?: string | null;
  relationship?: string | null;
  reason: string;
  urgency: Urgency;
  score: number;
  evidence: Evidence[];
  recommendedAction: string;
  suggestedMessage: string;
  recommendedChannel: Channel;
  lastMeaningfulInteraction?: string | null;
  sourceReferences: SourceReference[];
}

export interface SourceReference {
  recordType: Evidence["recordType"];
  recordId: UUID;
  label: string;
}

export interface ListingAction {
  listingId: UUID;
  address: string;
  action: string;
  detail: string;
  urgency: Urgency;
  /** Set when a draft already exists and Jamie only needs to review it. */
  sellerUpdateId?: UUID | null;
  marketingAssetKind?: MarketingAssetKind | null;
}

/* ------------------------------------------------------------- appointment */

export interface AppointmentPrep extends BaseRecord {
  calendarEventId: UUID;
  ownerId: UUID;
  contactSummary: string;
  recentCommunication: string[];
  knownGoals: string[];
  priorNotes: string[];
  relatedListingId?: UUID | null;
  relatedPropertyId?: UUID | null;
  outstandingQuestions: string[];
  talkingPoints: string[];
  evidence: Evidence[];
  aiRunId?: UUID | null;
}

/* -------------------------------------------------------------- integrations */

export type IntegrationStatus = "connected" | "needs_setup" | "planned";

export interface IntegrationConnection extends BaseRecord {
  provider: string;
  status: IntegrationStatus;
  connectedAt?: ISODate | null;
  lastSyncAt?: ISODate | null;
  accountLabel?: string | null;
  scopes: string[];
  error?: string | null;
}

/* ---------------------------------------------------------------- profiles */

export interface Profile extends BaseRecord {
  userId: UUID;
  fullName: string;
  email: string;
  role: "agent" | "admin" | "assistant";
  title?: string | null;
  phone?: string | null;
  licenseNumber?: string | null;
}

/* --------------------------------------------------------------- audit log */

export interface AuditLogEntry extends BaseRecord {
  actorId: UUID;
  actorType: "user" | "ai" | "system";
  action: string;
  entityType: string;
  entityId: UUID;
  metadata: Record<string, unknown>;
}

/* -------------------------------------------------------- marketing assets */

export interface MarketingAsset extends BaseRecord {
  listingId: UUID;
  label: string;
  assetType: "photo" | "video" | "floor_plan" | "document" | "other";
  url: string;
  sortOrder: number;
}

/** The full in-memory shape of the application's data. */
export interface Dataset {
  profiles: Profile[];
  contacts: Contact[];
  leads: Lead[];
  properties: Property[];
  listings: Listing[];
  showingFeedback: ShowingFeedback[];
  sellerUpdates: SellerUpdate[];
  buyers: BuyerProfile[];
  transactions: Transaction[];
  tasks: Task[];
  calendarEvents: CalendarEvent[];
  emailEvents: EmailEvent[];
  opportunities: Opportunity[];
  aiRuns: AIRun[];
  aiActions: AIAction[];
  listingMarketing: ListingMarketingAsset[];
  marketingAssets: MarketingAsset[];
  dailyBriefs: DailyBrief[];
  appointmentPreps: AppointmentPrep[];
  integrations: IntegrationConnection[];
  auditLog: AuditLogEntry[];
}

export function contactName(c: Pick<Contact, "firstName" | "lastName">) {
  return `${c.firstName} ${c.lastName}`.trim();
}

export function leadName(l: Pick<Lead, "firstName" | "lastName">) {
  return `${l.firstName} ${l.lastName}`.trim();
}

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  lead: "Lead",
  active_buyer: "Active Buyer",
  active_seller: "Active Seller",
  past_client: "Past Client",
  sphere: "Sphere",
  agent: "Agent",
  vendor: "Vendor",
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  call: "Call",
  text: "Text",
  email: "Email",
  in_person: "In person",
  handwritten_note: "Handwritten note",
};

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  listing_appointment: "Listing Appointment",
  showing: "Showing",
  buyer_consult: "Buyer Consultation",
  closing: "Closing",
  open_house: "Open House",
  inspection: "Inspection",
  photography: "Photography",
  internal: "Internal",
  personal: "Personal",
};

export const MARKETING_KIND_LABELS: Record<MarketingAssetKind, string> = {
  mls_description: "MLS Description",
  instagram_caption: "Instagram Caption",
  facebook_caption: "Facebook Caption",
  reel_caption: "Reel Caption",
  video_script_30: "30-Second Video Script",
  video_script_60: "60-Second Video Script",
  agent_email: "Agent Email",
  database_email: "Database Email",
  neighbor_email: "Neighbor Email",
  coming_soon_post: "Coming Soon Post",
  open_house_post: "Open House Post",
  price_adjustment_post: "Price Adjustment Announcement",
  pending_post: "Pending Post",
  just_sold_post: "Just Sold Post",
  feature_captions: "Property Feature Captions",
  hashtags: "Hashtags",
};

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  draft: "Draft",
  needs_review: "Needs Review",
  approved: "Approved",
  executed: "Sent",
  rejected: "Rejected",
};
