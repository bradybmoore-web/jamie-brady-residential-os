# Working in this repository

Read `IMPLEMENTATION_NOTES.md` first for the architectural decisions, and
`BUILD_PLAN.md` for what is done and what is deliberately deferred.

## The two rules that shape everything

**1. The model writes language; deterministic code produces facts.**

Ranking, scoring, metrics and evidence gathering live in `src/lib/scoring/` and
are plain TypeScript. Workflows call the AI only to phrase something. This is
why the app is fully usable with no API key, and why the scoring is testable.

When adding a feature: compute the decision in `lib/scoring/`, then ask the
model to write about it. Do not ask the model to decide.

**2. Every AI call supplies a deterministic `fallback`.**

`AIProvider.generateText` and `generateStructured` both require one. It is what
runs with no key and what the app degrades to when a model call fails. The
fallback has to be good enough to ship on its own — treat it as the product, not
a placeholder.

## Adding things

- **A new AI-backed feature** → a workflow in `src/lib/workflows/`. It must build
  an `EvidenceLedger`, call `recordRun()`, and ground its output. Follow
  `daily-command-center.ts`.
- **A new marketing format** → one entry in `MARKETING_TEMPLATES`
  (`src/lib/ai/prompts/marketing.ts`) plus a label in `MARKETING_KIND_LABELS`.
  Nothing else changes; a test asserts the two stay in sync.
- **A new integration** → `src/lib/integrations/<vendor>/` with `types.ts`,
  `mock.ts`, the real client, and `index.ts` resolving between them. Register it
  in `registry.ts` so the Settings page can say exactly what is missing.
- **A new assistant capability** → one entry in `TOOLS` (`src/lib/ai/tools.ts`).
  Tools return formatted text, not JSON. Read tools are free; write tools may
  only create drafts and tasks.
- **A new mutation** → a Server Action in `src/app/actions/`, starting with
  `actionContext()` and wrapped in `guard()`. Never mutate from a component.

## Things that must stay true

- Nothing outbound is ever sent. `email_draft`, `text_draft` and `stage_change`
  are constrained at the database level to require approval.
- No screen may present mocked data as real. If an adapter is in mock mode, the
  UI says so.
- Never scrape MLS data. The interface is licensed-feed shaped; the mock stays
  a mock until a licence exists.
- Seed rows carry `isSeed: true` and render a "Demo" marker.
- Nothing bypasses `DataStore` or `AIProvider` to reach Supabase or Anthropic
  directly.

## Before finishing

```bash
npm run check   # lint (zero warnings) → typecheck → test → build
```

Prose matters here — the output is read by a working agent, not a machine. Watch
for the pluralisation and grammar bugs that templated sentences invite; a couple
have already been caught in review ("in 1 days").
