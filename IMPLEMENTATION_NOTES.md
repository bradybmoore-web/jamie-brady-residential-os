# Implementation Notes — Jamie & Brady Residential OS

## 1. Starting point

The repository was **empty** (a bare git repo with no commits). There was no
existing stack to evaluate, extend, or migrate. The application was therefore
initialised fresh with `create-next-app` and built up from there.

> This repository is standalone. It contains no code, data, or dependency on
> any Moonflo or Mitchell Family Office repository.

## 2. Chosen architecture

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router, React 19, TypeScript) | Server Components + Server Actions remove the need for a separate API tier for a two-person brokerage. |
| Styling | Tailwind CSS v4 + hand-built primitives in the shadcn idiom | shadcn/ui pulls a large Radix dependency tree for components we mostly render statically. We wrote a small, fully-owned `components/ui` set with the same API shape, so shadcn components can be dropped in later without refactoring call sites. |
| Database | Supabase Postgres (schema + RLS written) | Requested, and the SQL migrations are complete and runnable. |
| Auth | Supabase Auth, with a demo passcode fallback | Lets Jamie log in *today*, before a Supabase project exists. |
| AI | Anthropic Claude via a provider interface | `AIProvider` is the seam. `AnthropicProvider` is real; `MockProvider` is deterministic and used when no key is present so every screen works offline. |
| Integrations | Adapter pattern per vendor | Each vendor exposes a typed interface with a mock provider and a real provider stub. Swapping in credentials is a config change, not a rewrite. |

### The two swappable seams

Everything that needs credentials sits behind one of two seams:

1. **`DataStore`** (`src/lib/data/store.ts`) — `MemoryStore` (seed data, works
   with zero configuration) or `SupabaseStore` (real Postgres). Selected at
   runtime by `resolveStore()` based on whether Supabase env vars are present.
2. **`AIProvider`** (`src/lib/ai/provider.ts`) — `AnthropicProvider` or
   `MockProvider`, selected by the presence of `ANTHROPIC_API_KEY`.

Every page, workflow, and server action is written against the interface, never
against Supabase or Anthropic directly.

### AI orchestration

There is **one** orchestration layer (`src/lib/ai/orchestrator.ts`) that runs
*named workflows*, not twelve autonomous agents. A workflow is a plain async
function that:

1. gathers facts from the `DataStore` and integration adapters,
2. builds a versioned prompt from `src/lib/ai/prompts/`,
3. calls the `AIProvider`,
4. validates the result with a Zod schema,
5. **re-grounds every claim against the source records it was given**, and
6. writes an `ai_runs` row plus zero or more `ai_actions` rows.

Evidence is never invented: `groundEvidence()` drops any `sourceReferences`
entry whose record id was not in the workflow's input set, and the UI renders
only surviving references.

### Approvals

Anything outbound (email, text, published marketing, stage changes) is created
as an `ai_action` with status `needs_review`. Nothing is ever sent from the app
in the MVP — "Send" marks `executed` and records the audit row, with a TODO
where the real transport goes.

## 3. Assumptions made (no credentials were available)

1. **No Supabase project exists.** The app runs on `MemoryStore` seeded with
   realistic Austin data. Migrations under `supabase/migrations/` are ready to
   `supabase db push` when a project exists.
2. **No Anthropic key.** `MockProvider` returns hand-written, realistic,
   deterministic output per workflow so every AI surface is demonstrable. The
   prompts sent to a real model are the same ones, and are unit-tested.
3. **Cloze API.** Cloze publishes a REST API for authenticated accounts; there
   is no publicly documented Cloze MCP server we could verify. The adapter is
   written REST-first (`src/lib/integrations/cloze/rest.ts`) with an MCP
   transport left as a documented, drop-in alternative. Cloze remains the CRM
   system of record — the OS only caches contacts (`contacts_cache`).
4. **Google.** Gmail/Calendar adapters are written against a narrow interface
   so either direct Google OAuth or a Zapier/MCP relay can implement it.
5. **MLS.** Mock provider only. No scraping anywhere in the codebase; the
   interface is RESO-shaped so MLS Grid / Trestle / Bridge can implement it.
6. **Jamie is the primary user; Brady is the second seat.** Records carry an
   `ownerId` and the seed data assigns work to both.
7. Seed records all carry `isSeed: true` and render a "Demo data" marker.

## 4. Known deliberate omissions

- No microservices, no queue, no background worker. Workflows run on request
  and cache their result for the day in `daily_briefs`.
- `MemoryStore` mutations live for the lifetime of the server process. That is
  correct for a demo and irrelevant once Supabase is connected.
- Mobile is responsive but desktop-first, as specified.
