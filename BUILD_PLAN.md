# Build Plan — Jamie & Brady Residential OS

Status legend: `[x]` done · `[~]` done with a mock/stub behind a real interface · `[ ]` not started

## Phase 1 — Foundation
- [x] Inspect repository (empty) and decide: initialise new Next.js app
- [x] `IMPLEMENTATION_NOTES.md` + `BUILD_PLAN.md`
- [x] Next.js 16 + TypeScript + Tailwind v4 + ESLint scaffold
- [x] Design system tokens (ivory / charcoal / brass) in `globals.css`
- [x] UI primitives (`components/ui`)
- [x] Env validation (`lib/env.ts`)
- [x] Domain types (`lib/types.ts`)
- [x] Supabase schema migration (23 tables, UUID PKs, timestamps, source_system/source_id)
- [x] Supabase RLS policies migration
- [x] `DataStore` interface + `MemoryStore` + `SupabaseStore`
- [x] Auth (Supabase Auth adapter + demo passcode fallback) + middleware route protection
- [x] App shell: sidebar, topbar, 10 navigation destinations

## Phase 2 — Today Dashboard
- [x] `dailyCommandCenter` workflow with structured output schema
- [x] Evidence grounding (AI cannot invent source references)
- [x] Summary metric strip (6 metrics)
- [x] "People Who Need You" priority cards with all four actions
- [x] Today's Schedule with per-event `Prepare Me`
- [x] Appointment prep view (contact summary, comms, goals, notes, property, questions, talking points)
- [x] Listing Attention panel
- [x] AI Opportunities panel

## Phase 3 — Leads
- [x] Lead record with the full specified field set
- [x] `analyzeLead()` structured extraction workflow
- [x] Lead pipeline stages (10) + UI views: New / Hot / Waiting / Follow-up Due
- [x] Lead table + lead detail
- [x] AI drafted response -> approval queue

## Phase 4 — Listings
- [x] Listing profile with the full specified field set
- [x] Listings dashboard by status (Pre-Listing → Closed)
- [x] Listing detail with AI recommendation
- [x] Marketing > Listing Studio, 16 generation actions
- [x] Reusable, versioned prompt templates + global writing guidelines / banned phrases
- [x] Seller update data model + generator (Facts / Interpretation / Recommendation / Draft)

## Phase 5 — Opportunities
- [x] `identifyFollowUpOpportunities()` scoring workflow
- [x] Relationship Opportunities screen with sorting/filtering
- [x] Contact cards with evidence + recommended outreach

## Phase 6 — AI Assistant
- [x] Tool registry architecture (18 tools — 13 read, 5 write)
- [x] Tool-calling loop in the orchestrator (provider-agnostic)
- [x] Chat interface with tool-call transparency
- [x] Action drafts routed to the approval queue

## Phase 7 — Integrations
- [x] Integration registry + status model (Connected / Needs Setup / Planned)
- [~] Cloze adapter (interface + mock + REST client; needs `CLOZE_API_KEY`)
- [~] Gmail adapter (interface + mock; needs Google OAuth)
- [~] Google Calendar adapter (interface + mock; needs Google OAuth)
- [~] MLS adapter (interface + mock; needs licensed RESO access)
- [~] ActivePipe engagement events (data model + mock feed)
- [x] Integrations page showing exactly what each vendor needs
- [x] Zapier / MCP relay documented as an alternative transport

## Phase 8 — Polish
- [x] Approval workflow UI (Approve / Edit / Reject / Send)
- [x] `ai_runs` + `ai_actions` audit records, surfaced in the UI
- [x] Loading, empty and error states
- [x] Responsive layout
- [x] Seed data (Lothian, Brackenridge, American Dr + contacts, leads, buyers, tasks)
- [x] README
- [x] `.env.example`
- [x] Unit tests (vitest) for scoring, grounding, prompts, workflows — 99 tests
- [x] Browser end-to-end smoke suite (`npm run test:e2e`) — 31 assertions
- [x] `lint` + `typecheck` + `test` + production `build` all green (`npm run check`)

## Security Phase 1 — pre-integration hardening
- [x] Remove the hard-coded fallback session signing secret; fail closed in production
- [x] Disable demo/passcode authentication entirely when Supabase Auth is configured
- [x] Approved-team-member allowlist (`0003_approved_team_members.sql`, 24th table); RLS denies by default
- [x] Column-level grants so a signed-in user cannot approve themselves
- [x] MLS status derived from the implemented-provider registry, never from env vars
- [x] Correct the `gmail.compose` documentation; no-send enforced in code and asserted by test
- [x] Rate limiting for sign-in and `/api/assistant` behind a swappable store
- [x] `/api/health` reduced to liveness only
- [x] Demo-data banners and per-row markers on Today, Opportunities, Marketing, Approvals
- [x] Security regression tests (`tests/security.test.ts`, `tests/rate-limit.test.ts`)

## Phase 2 — Supabase database and authentication foundation
- [x] Reviewed migrations 0001-0003 for ordering, dependencies and RLS coverage
- [x] `0004_integration_accounts.sql` — per-person credentials, owner-only RLS,
      credential columns readable by no user role (Phase 3 groundwork; unused)
- [x] `0005_profile_provenance.sql` — `source_system`/`source_id`/`is_seed` on
      `profiles`, a model/schema mismatch found by the conformance tests
- [x] Middleware session refresh via `supabase.auth.getUser()` — fixes the
      roughly-hourly logout
- [x] Three-state auth model (`anonymous` / `pending_approval` / `authorized`)
      and a `/pending-approval` screen
- [x] `npm run team:allow|revoke|list` — allowlist managed from the command
      line; no address is stored in source
- [x] `npm run db:verify` — pre-flight check to run before switching over
- [x] `npm run db:seed` rewritten: loads demo business data only, creates no
      accounts and grants no access
- [x] Real-PostgreSQL RLS tests (PGlite) — 45 assertions
- [x] Schema conformance tests — 20 assertions proving the domain model fits
- [ ] Switch to Supabase (blocked: needs Brady to create the project)

## Deferred (explicitly out of MVP scope)
- [ ] Real outbound send (email/SMS transport)
- [ ] Live MLS ingestion (blocked on licensing)
- [ ] Multi-tenant permissions beyond owner-scoped RLS
- [ ] Background schedulers / queues
