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
A tool-calling interface over the real book of business. Eighteen tools (13
read, 5 write), all going through the same data layer the pages use. It shows
what it looked at.

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
└── supabase/migrations/     25 tables, RLS policies, triggers.
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
npm run test       # vitest — unit, integration and security tests
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

The two `NEXT_PUBLIC_SUPABASE_*` variables are a single switch: setting them
moves **both** the database and authentication over at once. Removing them moves
both back. Do not set them until the verification step below passes.

1. Create a project at <https://supabase.com>.

2. **Turn off public signup.** Dashboard → Authentication → Sign In / Providers →
   Email → disable *Allow new users to sign up*. The allowlist means an
   unwanted signup grants nothing, but there is no reason to accept one.

3. Apply the schema. Easiest is one paste: copy all of
   `supabase/setup/all-migrations.sql` into the SQL editor and run it. That file
   is generated from the numbered migrations in order
   (`npm run db:build-setup` regenerates it), and it is idempotent — running it
   twice is harmless, which matters when a human is pasting it by hand.

   With the CLI instead:

   ```bash
   npx supabase link --project-ref <your-ref>
   npm run db:push
   ```

4. Allow the two people who should have access, **before creating their
   accounts** — the trigger reads the allowlist at the moment an account is
   created. Either edit the two placeholders in
   `supabase/setup/02-allowlist.sql` and run it in the SQL editor, or:

   ```bash
   npm run team:allow -- jamie@herdomain.com "Jamie Moore"
   npm run team:allow -- brady@hisdomain.com "Brady Moore"
   npm run team:list
   ```

   Addresses live in the database and on the command line, never in this
   repository.

5. Each person creates their account in the app (or via Dashboard →
   Authentication → Users → Add user). Because their address is allowlisted,
   they are approved automatically. **Anyone else who signs up gets an account
   that can read nothing** and sees the "not approved" screen.

6. Verify before switching over. Create one throwaway account with an address
   that is *not* allowlisted, then run `supabase/setup/03-negative-tests.sql` in
   the SQL editor. It exercises the real policies as the real roles — anonymous,
   unapproved, and approved — and every row of its output should read PASS.
   Delete the throwaway account afterwards.

   From a terminal, `npm run db:verify` performs a complementary check against
   the live project (tables present, anonymous reads nothing, someone is
   approved).

7. Only once that passes, put the two `NEXT_PUBLIC_SUPABASE_*` values into the
   environment and restart. The app switches to `SupabaseStore` and Supabase
   Auth together.

8. Optionally load the demo business data, owned by the approved accounts:

   ```bash
   npm run db:seed
   ```

   It creates no accounts and grants no access. Every row is marked `is_seed`
   and is labelled "Demo" in the app; remove it later with
   `delete from <table> where is_seed;`.

### Rolling back

Remove `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
restart. The app returns to in-memory demo data and passcode sign-in. The
Supabase project is untouched, so switching forward again is just putting the
two variables back.

### Sessions

Supabase access tokens last about an hour. The middleware calls
`supabase.auth.getUser()` on every request, which transparently exchanges an
expiring token for a fresh one and writes the new cookies onto the response —
including through a redirect. Without that step people were signed out roughly
hourly.

`getAuthState()` resolves one of three outcomes, and the distinction matters:

| State | Meaning | Where they land |
| --- | --- | --- |
| `anonymous` | No valid session | `/login` |
| `pending_approval` | Signed in, not authorized | `/pending-approval` |
| `authorized` | Approved team member | the app |

Authenticating and being authorized are different things. Collapsing them sent
an unapproved person back to a login screen they had just used successfully,
which reads as a broken app rather than a deliberate refusal.

### Authorizing team members

**Signing up does not grant access.** `profiles.approved` defaults to false, and
`is_team_member()` — which every row policy calls — requires it to be true. An
unapproved account can read exactly nothing, and the app refuses the session
outright rather than rendering an empty screen.

Approval comes from an explicit allowlist:

```bash
npm run team:allow  -- person@example.com "Their Name"
npm run team:list
npm run team:revoke -- person@example.com
```

Or, in the SQL editor:

```sql
select public.approve_team_member('person@example.com');
select public.revoke_team_member('person@example.com');
```

Addresses are never written into this repository. They live in the database and
are passed on the command line.

A signed-in user **cannot approve themselves**. `authenticated` has no column
privilege on `approved`, `approved_at`, `approved_by`, `user_id` or `email`, and
the insert policy independently rejects a self-inserted approved row. Both
`approve_team_member` and `revoke_team_member` are revoked from `anon` and
`authenticated`, so they require the service role or SQL editor.

You should still disable public signup in the Supabase dashboard
(Authentication → Providers). The allowlist means an unwanted signup grants
nothing, but there is no reason to accept one at all.

### Row level security

Beyond the approval gate, the policy model is **any approved team member can
read and write**. This is a two-person brokerage where both agents are trusted
with the whole book of business, and the brief asks not to build complicated
permissions.

Ownership is still recorded on every row (`owner_id`, `assigned_to`), so tighter
per-record policies can be layered on later without a schema change. `audit_log`
has insert and select policies but no update or delete policy, which makes it
append-only for every authenticated role.

> One consequence worth deciding on deliberately: once Gmail is connected, both
> agents can read everything in `email_events_cache`, including the other's
> client correspondence.

**`integration_accounts` is the exception.** It holds each person's own
credentials and is *not* team-wide: a row is visible only to the profile that
owns it, and the `access_token` / `refresh_token` columns are readable by no
user-facing role at all — only by server-side code holding the service role.
This is what makes Phase 3 safe: Jamie's Google tokens will belong to Jamie's
profile, not to a shared system identity, and Brady connecting his own account
later is a second row rather than a conflict.

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

**Do not mistake the scope for a safety control.** Google documents
`gmail.compose` as *"Manage drafts and send emails"* — it **does** permit
sending. An earlier version of this README claimed otherwise; that was wrong.

The guarantee that this product never sends mail is enforced in **code**:

- the Gmail adapter has no send method, and its only write is `POST /drafts`;
- the `EmailAdapter` interface has no send operation, so no replacement adapter
  can introduce one;
- outbound `ai_actions` are constrained in Postgres to require approval;
- a test asserts that no Gmail send endpoint or send scope appears anywhere in
  the source tree.

If sending is ever wanted it should be a separate, explicitly reviewed feature
with its own consent step — never a side effect of this adapter.

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

Setting the `MLS_*` variables is **not** sufficient to make data live, and
deliberately so: status is derived from the `LIVE_PROVIDERS` registry of
*implemented* providers, never from configuration. Configuring credentials
without an implementation logs a warning and keeps serving — and labelling — the
mock feed.

To go live:

1. Apply for a data licence through Unlock MLS for the Moore Residential Group
   account.
2. Choose an approved RESO Web API distributor: **MLS Grid**, **Trestle**, or
   **Bridge Interactive**.
3. Implement `MlsProvider` against that feed (e.g. `mls/mlsgrid.ts`).
4. Register it in `LIVE_PROVIDERS` and set `MLS_PROVIDER`, `MLS_API_URL`,
   `MLS_API_KEY`. Every status indicator in the product flips at that moment.

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
`/api/health` reports liveness only — no integration status, because that tells
an unauthenticated visitor whether real client data is behind the deployment.
The same information is on Settings → Integrations for signed-in members.

---

## Security

- **Authentication** on every route via middleware, with real verification
  server-side on each request (the middleware only redirects).
- **Fail-closed session signing.** There is no default signing key. In
  production a missing `SESSION_SECRET` disables sign-in rather than falling
  back to something guessable; outside production a random per-process key is
  used, so sessions simply do not survive a restart.
- **One way in.** When Supabase Auth is configured, demo/passcode
  authentication is disabled at four independent layers — the session resolver,
  the cookie decoder, the passcode verifier and the middleware — and a stale
  demo cookie is cleared from the browser.
- **Rate limiting** on sign-in (per address and per identifier) and on
  `/api/assistant` (per profile).
- **Deny-by-default authorization.** See "Authorizing team members" above.
- **Row level security** on all 25 tables. The service role key is used only by
  the seed script and never in a request path.
- **Server-side secrets only.** `lib/env.ts` is marked `server-only`; the only
  values that reach the browser are the two `NEXT_PUBLIC_` Supabase values.
- **Signed session cookies** — HMAC-SHA256, compared in constant time, `httpOnly`,
  `secure` in production.
- **Append-only audit log.** Every mutation writes an `audit_log` row with actor,
  action, entity and metadata. No update or delete policy exists on that table.
- **The AI cannot send.** No send code path exists, and a test enforces it. Drafts go to an approval queue. (Note the `gmail.compose` scope itself permits sending — the restraint is in the code, not the grant.)
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
3. **The demo passcode is not authentication.** It is a shared gate, and it is
   disabled automatically the moment Supabase Auth is configured. Connect
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
10. **Rate limiting is in-process.** Limits are per instance and reset on
    deploy. Swap in a durable `RateLimitStore` before running more than one
    instance.
11. **Google OAuth is not built yet.** There is no callback route, and the
    adapter still reads a single refresh token from the environment. The
    *storage* for per-person tokens exists and is tested
    (`integration_accounts`), but nothing writes to it. This is Phase 3.
12. **Rate limits and the in-memory store are per instance.** Both assume a
    single server. Swap in a durable `RateLimitStore` before scaling out.

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
supabase/migrations/  Schema, RLS, allowlist, per-person integration accounts
scripts/              Supabase seed loader
tests/                unit, integration, security and real-Postgres RLS tests,
                      plus tests/e2e/ browser smoke
```

`IMPLEMENTATION_NOTES.md` records the architectural decisions and the
assumptions made where credentials were unavailable. `BUILD_PLAN.md` is the
phase-by-phase checklist.
