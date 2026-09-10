import "server-only";
import { capabilities, env } from "@/lib/env";
import { activePipeInfo } from "./activepipe";
import { calendarInfo } from "./calendar";
import { clozeInfo } from "./cloze";
import { emailInfo } from "./email";
import { mlsInfo } from "./mls";
import type { AdapterInfo, IntegrationDescriptor } from "./types";
import type { IntegrationStatus } from "@/lib/types";

export type { AdapterInfo, IntegrationDescriptor };

/**
 * The single source of truth for the Integrations page.
 *
 * For every vendor: what it does, what it unlocks, exactly which environment
 * variables it needs, and the steps to connect it. Nothing here is vague —
 * "Needs Setup" always comes with the specific thing that is missing.
 */
export const INTEGRATIONS: IntegrationDescriptor[] = [
  {
    key: "cloze",
    name: "Cloze",
    category: "crm",
    summary:
      "The CRM system of record. Contacts, relationship history, tasks and notes live in Cloze and stay there.",
    unlocks: [
      "Real contact and relationship history behind every priority card",
      "Tasks created here appear in Cloze",
      "Notes written here are written back to the contact record",
    ],
    envVars: [
      { name: "CLOZE_API_KEY", description: "API key from your Cloze account settings", required: true },
      { name: "CLOZE_USER_EMAIL", description: "The Cloze user the API acts as", required: true },
      { name: "CLOZE_API_URL", description: "Override the API base URL (defaults to https://api.cloze.com/v1)", required: false },
      { name: "CLOZE_MCP_URL", description: "Optional MCP endpoint if you prefer routing Cloze through MCP", required: false },
    ],
    setupSteps: [
      "In Cloze, open Settings → Integrations → API and generate a key for the team account.",
      "Set CLOZE_API_KEY and CLOZE_USER_EMAIL in your environment.",
      "Restart the app and reload this page — the status will flip to Connected.",
      "Run a contact sync from the Cloze card to populate the contact cache.",
    ],
    docsUrl: "https://www.cloze.com/app/help",
  },
  {
    key: "gmail",
    name: "Gmail",
    category: "email",
    summary: "Read threads, find messages nobody answered, and stage drafts. This app never sends mail.",
    unlocks: [
      "Unanswered emails surface on the Today page",
      "Approved drafts land in your Gmail drafts folder",
      "Inbound inquiries are classified into leads automatically",
    ],
    envVars: [
      { name: "GOOGLE_CLIENT_ID", description: "OAuth client ID from Google Cloud Console", required: true },
      { name: "GOOGLE_CLIENT_SECRET", description: "OAuth client secret", required: true },
      { name: "GOOGLE_REFRESH_TOKEN", description: "Refresh token for the mailbox owner", required: true },
    ],
    setupSteps: [
      "Create a Google Cloud project and enable the Gmail API.",
      "Create an OAuth 2.0 Client ID of type Desktop app.",
      "Run the consent flow requesting scopes gmail.readonly and gmail.compose.",
      "Store the resulting refresh token as GOOGLE_REFRESH_TOKEN.",
    ],
    docsUrl: "https://developers.google.com/gmail/api",
  },
  {
    key: "google_calendar",
    name: "Google Calendar",
    category: "calendar",
    summary: "Today's schedule and appointment preparation. Shares the Gmail OAuth client.",
    unlocks: [
      "Today's Schedule reflects your real calendar",
      "Prepare Me briefs are generated for real appointments",
      "Approved appointments can be written back to your calendar",
    ],
    envVars: [
      { name: "GOOGLE_CLIENT_ID", description: "Same client as Gmail", required: true },
      { name: "GOOGLE_CLIENT_SECRET", description: "Same client as Gmail", required: true },
      { name: "GOOGLE_REFRESH_TOKEN", description: "Must include calendar scopes", required: true },
    ],
    setupSteps: [
      "Enable the Google Calendar API in the same Cloud project.",
      "Add scopes calendar.readonly and calendar.events to your consent flow.",
      "Re-run consent so the refresh token covers both Gmail and Calendar.",
    ],
    docsUrl: "https://developers.google.com/calendar",
  },
  {
    key: "google_drive",
    name: "Google Drive",
    category: "storage",
    summary: "Listing photography, floor plans and documents. Planned — not required for the MVP.",
    unlocks: ["Marketing assets attached to a listing", "Documents attached to a transaction"],
    envVars: [{ name: "GOOGLE_REFRESH_TOKEN", description: "Must include drive.file scope", required: true }],
    setupSteps: [
      "Enable the Google Drive API.",
      "Add the drive.file scope to the consent flow.",
      "Point marketing assets at the shared team folder.",
    ],
  },
  {
    key: "activepipe",
    name: "ActivePipe",
    category: "marketing",
    summary:
      "Keeps running database nurture. This product reads engagement signals to decide who deserves a personal call.",
    unlocks: [
      "Real open and click history behind Relationship Opportunities",
      "Property-click signals feed buyer matching",
    ],
    envVars: [{ name: "ACTIVEPIPE_API_KEY", description: "API key from your ActivePipe account manager", required: true }],
    setupSteps: [
      "Request API access from your ActivePipe account manager.",
      "Set ACTIVEPIPE_API_KEY.",
      "Map ActivePipe contacts to Cloze contacts by email address.",
    ],
  },
  {
    key: "unlock_mls",
    name: "Unlock MLS",
    category: "mls",
    summary:
      "Licensed MLS data for comparables, buyer matching and seller updates. Nothing here scrapes a portal.",
    unlocks: [
      "Real competing actives, pendings and solds in seller updates",
      "Listing-fit scoring against live inventory for every buyer profile",
      "Status-change alerts on the competitive set",
    ],
    envVars: [
      { name: "MLS_PROVIDER", description: "mlsgrid | trestle | bridge (currently only 'mock' is implemented)", required: true },
      { name: "MLS_API_URL", description: "RESO Web API base URL from your data provider", required: true },
      { name: "MLS_API_KEY", description: "Access token issued with your data licence", required: true },
    ],
    setupSteps: [
      "Apply for a data licence through Unlock MLS for the Moore Residential Group account.",
      "Choose an approved RESO Web API distributor: MLS Grid, Trestle, or Bridge Interactive.",
      "Implement the MlsProvider interface in src/lib/integrations/mls/ against that feed.",
      "Set MLS_PROVIDER, MLS_API_URL and MLS_API_KEY, then register the provider in getMlsProvider().",
    ],
  },
  {
    key: "docusign",
    name: "DocuSign",
    category: "documents",
    summary: "Contract status on the transaction timeline. Planned — signature requests stay in DocuSign.",
    unlocks: ["Envelope status on transaction milestones", "Signed document links on the transaction record"],
    envVars: [
      { name: "DOCUSIGN_INTEGRATION_KEY", description: "Integration key from the DocuSign admin console", required: true },
    ],
    setupSteps: [
      "Create a DocuSign integration key with JWT grant.",
      "Grant consent for the team account.",
      "Set DOCUSIGN_INTEGRATION_KEY.",
    ],
  },
  {
    key: "zapier",
    name: "Zapier / MCP",
    category: "automation",
    summary:
      "An alternative transport for any of the above. Slower and less precise than a direct API, but connects in minutes.",
    unlocks: ["A working Gmail or Cloze connection without building an OAuth flow", "Custom triggers from other tools"],
    envVars: [{ name: "ZAPIER_MCP_URL", description: "Your Zapier MCP server endpoint", required: true }],
    setupSteps: [
      "Create a Zapier MCP server at mcp.zapier.com and expose the actions you want.",
      "Set ZAPIER_MCP_URL.",
      "Route a specific adapter through it — see README → 'Zapier / MCP as an alternative transport'.",
    ],
  },
];

export interface IntegrationState extends IntegrationDescriptor {
  status: IntegrationStatus;
  mode: "mock" | "live";
  /** Env vars still missing, so the UI can say exactly what is needed. */
  missing: string[];
  notes?: string;
}

const ADAPTER_INFO: Record<string, () => AdapterInfo> = {
  cloze: clozeInfo,
  gmail: emailInfo,
  google_calendar: calendarInfo,
  activepipe: activePipeInfo,
  unlock_mls: mlsInfo,
};

const PLANNED = new Set(["google_drive", "docusign", "zapier"]);

export function getIntegrationStates(): IntegrationState[] {
  return INTEGRATIONS.map((descriptor) => {
    const missing = descriptor.envVars
      .filter((v) => v.required && !process.env[v.name]?.trim())
      .map((v) => v.name);

    const info = ADAPTER_INFO[descriptor.key]?.();
    const status: IntegrationStatus = info
      ? info.status
      : PLANNED.has(descriptor.key)
        ? planned(descriptor.key)
        : missing.length === 0
          ? "connected"
          : "needs_setup";

    return {
      ...descriptor,
      status,
      mode: info?.mode ?? "mock",
      missing,
      notes: info?.notes,
    };
  });
}

function planned(key: string): IntegrationStatus {
  if (key === "zapier" && capabilities.zapier) return "needs_setup";
  if (key === "docusign" && capabilities.docusign) return "needs_setup";
  if (key === "google_drive" && env.googleRefreshToken) return "needs_setup";
  return "planned";
}
