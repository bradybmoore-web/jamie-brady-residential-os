# Jamie & Brady Residential OS

An AI operating system for the Moore Residential Group, a luxury residential real
estate team in Austin, Texas.

This is not another CRM. Cloze stays the system of record and ActivePipe keeps
running database nurture. This sits **on top** of the tools already in use and
answers one question every morning:

> Who needs Jamie today, why, and what should she say?

And then it does the preparation. Not *"follow up with John Smith"* but:

> **Call John Smith today.** He said in May that he planned to revisit moving once
> school started. School has started, he has opened the last market email twice,
> and there has been no personal contact in 41 days.
> *"John, you told me you would take another look at this once things settled..."*

---

## Table of contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Running it locally](#running-it-locally)
- [Environment variables](#environment-variables)
- [Supabase setup](#supabase-setup)
- [Connecting Cloze](#connecting-cloze)
- [Connecting Google](#connecting-google)
- [Zapier / MCP as an alternative transport](#zapier--mcp-as-an-alternative-transport)
- [ActivePipe](#activepipe)
- [MLS roadmap](#mls-roadmap)
- [Deployment](#deployment)
- [Security](#security)
- [Known limitations](#known-limitations)
- [Next development priorities](#next-development-priorities)

---

## What it does

### Today
The morning dashboard. Six metrics, a ranked list of **People Who Need You**,
today's schedule with a **Prepare Me** brief per appointment, listings that need
attention, and opportunities the system noticed that Jamie would otherwise miss.

Every priority card carries its reason, the records that reason came from, the
recommended action, and an opening line she can read off the screen and dial.

### Leads
Ten pipeline stages, four working views (New / Hot / Waiting / Follow-up Due).
Every inquiry is classified for type, intent confidence, location, timeline and
urgency, scored 0–100, and given a drafted reply that waits in Approvals.

### Listings
Grouped by lifecycle from Pre-Listing to Closed. Each listing carries the full
marketing profile — features, improvements, lifestyle points, positioning, the
seller's own writing notes and their prohibited phrases — plus showings,
feedback, engagement and the seller-update clock.

### Marketing → Listing Studio
Sixteen content formats per listing, written from that property's own facts.
Global writing guidelines ban the stock real-estate vocabulary; seller-specific
prohibitions are enforced on top. Generated copy that trips either list is
flagged rather than shipped.

### Opportunities
Relationship intelligence. Not a list of stale tasks — a scoring pass across
time since the last real conversation, stated plans that have come due, email
and property engagement, closing anniversaries, and active clients who have gone
quiet, weighted by what kind of relationship it is.

### AI Assistant
A tool-calling interface over the real book of business. Sixteen tools, all
reading through the same data layer the pages use. It shows what it looked at.

### Approvals
Everything outbound waits here. The system may read, summarise, prioritise,
draft, and prepare. Sending, publishing, changing a CRM stage or moving an
appointment needs a human.

---

## Architecture

```
Next.js 16 (App Router, React 19, TypeScript)
│
├── app/(app)/…              Server Components. One page per navigation item.
├── app/actions/…            Server Actions. Every mutation goes through one.
├── app/api/assistant        The only route handler (client-driven chat).
│
├── lib/data/store.ts        ← seam 1: DataStore interface
│     ├── memory-store.ts      seeded, zero configuration
│     └── supabase-store.ts    Postgres + row level security
│
├── lib/ai/provider.ts       ← seam 2: AIProvider interface
│     ├── anthropic-provider   Claude
│     └── mock-provider        deterministic fallback
│
├── lib/scoring/…            Deterministic ranking. No model involved.
├── lib/workflows/…          Six named workflows, one orchestration layer.
├── lib/integrations/…       One adapter per vendor: interface + mock + real.
└── supabase/migrations/     18 tables, RLS policies, triggers.
```

### The two ideas the whole thing rests on

**1. The model writes language. It does not produce facts.**

Scoring, ranking, evidence gathering and metrics are deterministic TypeScript in
`lib/scoring/`. The model is asked to phrase things — an opening line, a market
interpretation, a listing description. This is why the product works with no API
key at all, why the rankings are stable and explainable, and why the scoring is
unit-testable.

**2. Evidence is grounded structurally, not hopefully.**

Each workflow declares the exact set of records it read into an `EvidenceLedger`.
Anything citing a record outside that set is **dropped before it reaches the UI**
and counted in the brief's warnings. A recommendation cannot reference a showing
that did not happen, because the id would not be in the ledger.

Every run writes an `ai_runs` row: workflow, prompt version, model, provider, the
record ids it was allowed to read, latency, tokens, and any error. Visible under
Settings → Recent AI activity.

### Approvals

`AIAction` rows move `draft → needs_review → approved → executed`, or
`→ rejected`. Outbound types (`email_draft`, `text_draft`, `stage_change`) are
constrained at the **database level** to require approval:

```sql
alter table public.ai_actions
  add constraint ai_actions_outbound_requires_approval
  check (requires_approval or type not in ('email_draft','text_draft','stage_change'));
```

Nothing in this application transmits a message to a client. "Send" places a
draft in Gmail (when connected) and records the action as executed.

---

## Running it locally

Requires Node 20 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Sign in as **Jamie Moore** with the passcode
`residential`.

That is the whole setup. With no configuration at all you get the seeded Austin
dataset, deterministic AI output on every surface, and mock adapters for Cloze,
Gmail, Calendar, ActivePipe and the MLS. Everything mocked is labelled as such
in the interface.

### Checks

```bash
npm run lint       # eslint, zero warnings tolerated
npm run typecheck  # tsc --noEmit
npm run test       # vitest — 99 unit and integration tests
npm run build      # production build
npm run check      # all four, in order

# End-to-end, against a running server (login, priority cards, marketing
# generation, the approval queue, the assistant, mobile layout):
npx playwright install chromium
npm run build && npm run start   # in another terminal
npm run test:e2e
```

---

## Environment variables

Copy `.env.example` to `.env.local`. **The application runs with none of them
set.** Each one turns a mock into the real thing.

| Variable | Effect when set |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Data persists in Postgres under RLS instead of memory |
| `SUPABASE_SERVICE_ROLE_KEY` | Enables `npm run db:seed`. Server-side only |
| `ANTHROPIC_API_KEY` | Claude writes the language instead of templates |
| `ANTHROPIC_MODEL` | Override the model (default `claude-sonnet-5`) |
| `CLOZE_API_KEY`, `CLOZE_USER_EMAIL` | Real contacts, history, tasks and notes |
| `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` | Real Gmail and Calendar |
| `ACTIVEPIPE_API_KEY` | Real engagement signals |
| `MLS_PROVIDER`, `MLS_API_URL`, `MLS_API_KEY` | Licensed MLS data |
| `ZAPIER_MCP_URL` | Alternative transport (see below) |
| `DEMO_PASSCODE` | Passcode for demo sign-in (default `residential`) |
| `SESSION_SECRET` | **Required in production.** Signs the demo session cookie |

Settings → Integrations shows, per vendor, exactly which variables are still
missing and the steps to obtain them.

---

## Supabase setup

1. Create a project at <https://supabase.com>.
2. Copy the URL and anon key from **Project Settings → API** into `.env.local`.
3. Apply the migrations:

   ```bash
   npx supabase link --project-ref <your-ref>
   npm run db:push
   ```

   Or paste `supabase/migrations/0001_init.sql` then `0002_rls.sql` into the SQL
   editor, in that order.

4. Load the demo data (optional, and it creates two auth users):

   ```bash
   SUPABASE_SERVICE_ROLE_KEY=… npm run db:seed
   ```

   The script prints a temporary password per agent. Change them immediately.
   Every row it writes is marked `is_seed`, so `delete from <table> where is_seed;`
   removes all of it later.

5. Restart. The app detects Supabase, switches to `SupabaseStore`, and swaps the
   login screen for Supabase Auth.

### Row level security

Policy model: **any authenticated user with a profile row can read and write.**
This is a two-person brokerage where both agents are trusted with the whole book
of business, and the brief explicitly asks not to build complicated permissions.

Ownership is still recorded on every row (`owner_id`, `assigned_to`), so tighter
per-record policies can be layered on later without a schema change. `audit_log`
has insert and select policies but no update or delete policy, which makes it
append-only for every authenticated role.

---

## Connecting Cloze

Cloze remains the CRM system of record. This application caches contacts for
scoring (`contacts_cache`) and writes tasks and notes back. It does not attempt
to replace it.

1. In Cloze: **Settings → Integrations → API**, generate a key for the team
   account.
2. Set `CLOZE_API_KEY` and `CLOZE_USER_EMAIL`.
3. Restart. `getClozeAdapter()` returns `RestClozeAdapter` instead of the mock.

**A caveat worth reading.** Cloze's API is account-gated and its exact response
shapes could not be verified against a live tenant during development. Every
response in `src/lib/integrations/cloze/rest.ts` passes through a narrow
normaliser rather than being trusted structurally, so a differently-named field
degrades to `null` instead of crashing a page. When you connect a real key,
expect to adjust the normalisers — and only the normalisers. No caller changes.

There is no publicly documented Cloze MCP server we could verify, so the adapter
is REST-first. `CLOZE_MCP_URL` is reserved for that transport; see below.

---

## Connecting Google

One OAuth client covers Gmail and Calendar.

1. Create a project in the Google Cloud Console.
2. Enable the **Gmail API** and the **Google Calendar API**.
3. Create an OAuth 2.0 Client ID of type *Desktop app*.
4. Run the consent flow requesting:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
5. Store the refresh token as `GOOGLE_REFRESH_TOKEN`, alongside the client id
   and secret.

The scope is `gmail.compose`, not `gmail.send` — deliberately. `gmail.compose`
creates drafts. The application is not capable of sending mail even if a future
change tried to.

Tokens are exchanged server-side per request in `lib/integrations/google-auth.ts`
and cached in memory until expiry. No token reaches the browser.

---

## Zapier / MCP as an alternative transport

Building a Google OAuth flow takes an afternoon. A Zapier MCP server takes ten
minutes. If you want Gmail or Cloze working today:

1. Create an MCP server at <https://mcp.zapier.com> and expose the actions you
   want (Gmail: Find Email, Create Draft; Cloze: Find Contact, Create Task).
2. Set `ZAPIER_MCP_URL`.
3. Implement the adapter interface against it. For Gmail that means one new file
   satisfying `EmailAdapter` (`searchEmails`, `getThread`, `findUnanswered`,
   `draftEmail`, `classifyInbound`) and one branch in
   `src/lib/integrations/email/index.ts`.

The adapter interfaces are narrow precisely so a relay can satisfy them. Expect
higher latency and less precise search than the direct API; it is a good way to
prove value before committing to the OAuth work.

---

## ActivePipe

ActivePipe is **not** replaced. It keeps running database nurture and email
marketing.

What this product does with it: reads engagement events (`email_open`,
`email_click`, `campaign_response`, `property_click`) and uses them to decide who
deserves a *personal* call — which is the thing automated nurture cannot do. That
is how David Collins surfaces: four market emails opened, two property clicks, no
human contact in seven months.

The data model and read interface exist. A live adapter needs `ACTIVEPIPE_API_KEY`
from your account manager, and contacts matched to Cloze by email address.

---

## MLS roadmap

**Nothing in this codebase scrapes a portal, and no screen depends on live MLS
data to function.**

`src/lib/integrations/mls/` defines a RESO-shaped interface —
`searchProperties`, `getProperty`, `getComparables`, `getStatusChanges`,
`getNewListings`, `getPendings`, `getSolds` — with a local mock feed of Austin
inventory behind it. Comparables in seller updates and listing-fit scoring for
buyers both run through it today, on mock data, clearly labelled.

To go live:

1. Apply for a data licence through Unlock MLS for the Moore Residential Group
   account.
2. Choose an approved RESO Web API distributor: **MLS Grid**, **Trestle**, or
   **Bridge Interactive**.
3. Implement `MlsProvider` against that feed (e.g. `mls/mlsgrid.ts`).
4. Set `MLS_PROVIDER`, `MLS_API_URL`, `MLS_API_KEY` and register the provider in
   `getMlsProvider()`.

No caller changes. Seller updates and buyer matching light up with real data the
same day.

---

## Deployment

Vercel is the intended target.

```bash
npx vercel
```

Then in the Vercel dashboard, add the environment variables you have. At minimum
for anything reachable from the internet:

- `SESSION_SECRET` — generate with `openssl rand -base64 32`
- `DEMO_PASSCODE` — change it from the default

**Before real client data goes in**, connect Supabase and use Supabase Auth. The
demo passcode is a shared gate for demonstrations, not authentication.

The middleware protects every route except `/login` and `/api/health`.
`/api/health` reports liveness and which capabilities are live — booleans only,
never a key or a URL.

---

## Security

- **Authentication** on every route via middleware, with real verification
  server-side on each request (the middleware only redirects).
- **Row level security** on all 22 tables. The service role key is used only by
  the seed script and never in a request path.
- **Server-side secrets only.** `lib/env.ts` is marked `server-only`; the only
  values that reach the browser are the two `NEXT_PUBLIC_` Supabase values.
- **Signed session cookies** — HMAC-SHA256, compared in constant time, `httpOnly`,
  `secure` in production.
- **Append-only audit log.** Every mutation writes an `audit_log` row with actor,
  action, entity and metadata. No update or delete policy exists on that table.
- **The AI cannot send.** No send scope is ever requested; drafts go to a queue.
- **Fair housing** rules are in the shared writing guidelines, and copy is
  screened against a banned-phrase list plus per-seller prohibitions.

---

## Known limitations

Stated plainly, because a demo that pretends otherwise wastes everyone's time.

1. **Without Supabase, data lives in memory** and resets when the server
   restarts. Tasks completed and drafts approved during a demo do not survive a
   redeploy.
2. **Without an Anthropic key, all AI language is templated.** The templates are
   built from real record data and are genuinely usable, but they are not what
   the product does with Claude connected.
3. **The demo passcode is not authentication.** It is a shared gate. Connect
   Supabase Auth before real client data.
4. **The Cloze REST adapter is unverified** against a live tenant — see
   [Connecting Cloze](#connecting-cloze).
5. **MLS data is a mock feed.** Every screen that uses it says so, and the seller
   update panel warns before you would send figures to a seller.
6. **Nothing is actually sent.** By design for the MVP: approving an email marks
   it executed and stages a Gmail draft. There is no SMS transport at all. The
   Approvals page says this outright while Gmail is unconnected, and records
   what actually happened on each executed item.
7. **No background scheduler.** Workflows run on request. The daily brief is
   cached per day; opportunities are regenerated on demand.
8. **Desktop-first.** Responsive down to phone width, but the dense tables are
   designed for a real screen.
9. **`MemoryStore` is single-process.** Fine for one or two people on one server;
   it is not a substitute for the database.

---

## Next development priorities

In the order they would deliver the most value:

1. **Connect Supabase and Cloze.** Everything else is downstream of the product
   running on the real book of business. The adapters are written; this is
   configuration plus verifying the Cloze response shapes.
2. **Connect Google.** Unanswered email is the single strongest signal the
   scoring engine has, and today it comes from seed data. This is what makes the
   Today page trustworthy rather than merely impressive.
3. **Connect Claude.** Turns competent templates into copy Jamie would actually
   send, across every surface at once.
4. **Automated lead capture.** Classify inbound Gmail on arrival and create the
   lead without anyone typing. Speed to lead is the highest-leverage thing in
   the whole business, and it is currently manual.
5. **Apply for MLS access and implement one RESO provider.** Seller updates stop
   being illustrative and start being the reason sellers stay.

Beyond that: real send transport with per-recipient rate limits, a nightly
scheduled brief delivered by email before Jamie opens her laptop, buyer-listing
match alerts on new inventory, and DocuSign envelope status on the transaction
timeline.

---

## Repository layout

```
src/
  app/
    (app)/          Authenticated shell and all ten navigation pages
    actions/        Server Actions — every mutation
    api/            /api/health, /api/assistant
    login/          Sign-in
  components/
    ui/             Design primitives
    shell/          Navigation
    today/ leads/ listings/ marketing/ opportunities/ approvals/ assistant/
  lib/
    ai/             Provider interface, grounding, audit, prompts, tool registry
    auth/           Session handling
    data/           DataStore interface, memory + Supabase stores, seed data
    integrations/   cloze, email, calendar, mls, activepipe, registry
    scoring/        Deterministic ranking engines
    workflows/      The six named workflows
supabase/migrations/  Schema and RLS
scripts/              Supabase seed loader
tests/                99 unit and integration tests, plus tests/e2e/ browser smoke
```

`IMPLEMENTATION_NOTES.md` records the architectural decisions and the
assumptions made where credentials were unavailable. `BUILD_PLAN.md` is the
phase-by-phase checklist.
