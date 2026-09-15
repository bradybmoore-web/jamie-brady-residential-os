/**
 * Physical table names.
 *
 * Extracted from the store so tests can assert that the TypeScript model and
 * the SQL schema still agree without importing server-only code.
 */
export const TABLE = {
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
