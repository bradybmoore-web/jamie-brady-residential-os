import type { Metadata } from "next";
import { Check, CircleDashed, Clock } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { capabilities, env, environmentReport } from "@/lib/env";
import { getIntegrationStates, type IntegrationState } from "@/lib/integrations/registry";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageTitle,
  SectionTitle,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings & Integrations" };
export const dynamic = "force-dynamic";

const STATUS_META = {
  connected: { label: "Connected", tone: "good" as const, Icon: Check },
  needs_setup: { label: "Needs Setup", tone: "warn" as const, Icon: Clock },
  planned: { label: "Planned", tone: "neutral" as const, Icon: CircleDashed },
};

export default async function SettingsPage() {
  const session = await requireSession();
  const store = await getStore();
  const integrations = getIntegrationStates();
  const report = environmentReport();
  const runs = (await store.listAIRuns()).slice(0, 12);

  const connected = integrations.filter((i) => i.status === "connected").length;

  return (
    <div className="px-4 py-7 lg:px-8">
      <header>
        <p className="eyebrow">System</p>
        <PageTitle className="mt-1.5">Settings &amp; Integrations</PageTitle>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
          {connected} of {integrations.length} services connected. Everything not connected runs on a mock adapter,
          and every screen that shows mocked data says so.
        </p>
      </header>

      {/* Runtime state */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>This deployment</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Row label="Signed in as" value={`${session.fullName} (${session.email})`} />
            <Row
              label="Authentication"
              value={session.mode === "supabase" ? "Supabase Auth" : "Demo passcode — not for real client data"}
              tone={session.mode === "supabase" ? undefined : "warn"}
            />
            <Row
              label="Database"
              value={capabilities.supabase ? "Supabase Postgres" : "In-memory seed data (resets on restart)"}
              tone={capabilities.supabase ? undefined : "warn"}
            />
            <Row
              label="AI provider"
              value={capabilities.anthropic ? `Anthropic — ${env.anthropicModel}` : "Deterministic fallback (no API key)"}
              tone={capabilities.anthropic ? undefined : "warn"}
            />
          </dl>

          <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
            {report.map((note) => (
              <li key={note.key} className="flex items-start gap-2 text-[12.5px]">
                <span
                  aria-hidden
                  className={`mt-1.5 size-1.5 shrink-0 rounded-full ${note.ok ? "bg-good" : "bg-warn"}`}
                />
                <span>
                  <span className="font-medium text-ink">{note.key}</span>{" "}
                  <span className="text-ink-muted">{note.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Integrations */}
      <section className="mt-8">
        <SectionTitle>Integrations</SectionTitle>
        <div className="mt-3 flex flex-col gap-3">
          {integrations.map((integration) => (
            <IntegrationCard key={integration.key} integration={integration} />
          ))}
        </div>
      </section>

      {/* AI audit */}
      <section className="mt-8">
        <SectionTitle>Recent AI activity</SectionTitle>
        <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-ink-muted">
          Every workflow run is recorded with its prompt version, model, the records it was allowed to read, and how
          long it took. Nothing the system recommends is untraceable.
        </p>
        <Card className="mt-3 overflow-hidden">
          {runs.length === 0 ? (
            <p className="px-5 py-6 text-[13px] text-ink-muted">No AI runs recorded yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Workflow</Th>
                  <Th className="hidden md:table-cell">Prompt</Th>
                  <Th className="hidden lg:table-cell">Model</Th>
                  <Th>Records</Th>
                  <Th className="hidden sm:table-cell">Latency</Th>
                  <Th>When</Th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <Td>
                      <span className="capitalize text-ink">{run.workflow.replace(/_/g, " ")}</span>
                      <div className="max-w-[420px] truncate text-[11.5px] text-ink-faint">{run.outputSummary}</div>
                    </Td>
                    <Td className="hidden font-mono text-[11.5px] text-ink-muted md:table-cell">{run.promptVersion}</Td>
                    <Td className="hidden text-[12px] text-ink-muted lg:table-cell">
                      {run.model}
                      <div className="text-[11px] text-ink-faint">{run.provider}</div>
                    </Td>
                    <Td className="tabular text-[12.5px]">{run.inputRecordIds.length}</Td>
                    <Td className="tabular hidden text-[12.5px] text-ink-muted sm:table-cell">{run.latencyMs} ms</Td>
                    <Td className="whitespace-nowrap text-[12px] text-ink-muted">{formatDate(run.startedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </section>

      <section className="mt-8">
        <SectionTitle>What requires your approval</SectionTitle>
        <Card className="mt-3">
          <CardContent className="pt-4">
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <div className="eyebrow text-good">The system may do on its own</div>
                <ul className="mt-2 flex flex-col gap-1 text-[12.5px] text-ink-muted">
                  {[
                    "Read your data",
                    "Summarise and prioritise",
                    "Create drafts",
                    "Suggest tasks",
                    "Generate marketing copy",
                    "Draft seller updates",
                    "Prepare appointment briefs",
                  ].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="eyebrow text-urgent">Always needs you</div>
                <ul className="mt-2 flex flex-col gap-1 text-[12.5px] text-ink-muted">
                  {[
                    "Sending client email",
                    "Sending text messages",
                    "Deleting records",
                    "Changing CRM stages",
                    "Publishing public marketing",
                    "Modifying appointments",
                    "Anything legally meaningful",
                  ].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function IntegrationCard({ integration }: { integration: IntegrationState }) {
  const meta = STATUS_META[integration.status];
  const Icon = meta.Icon;

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{integration.name}</CardTitle>
            <Badge tone={meta.tone}>
              <Icon className="size-2.5" strokeWidth={2.5} aria-hidden />
              {meta.label}
            </Badge>
            <Badge tone="outline">{integration.category}</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-muted">{integration.summary}</p>
        </div>
      </CardHeader>

      <CardContent>
        {integration.notes ? (
          <p className="mb-3 rounded-[4px] bg-surface-sunk/60 px-3 py-2 text-[12px] leading-relaxed text-ink-muted">
            {integration.notes}
          </p>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <div className="eyebrow">What this unlocks</div>
            <ul className="mt-1.5 flex flex-col gap-1">
              {integration.unlocks.map((u) => (
                <li key={u} className="text-[12.5px] leading-relaxed text-ink-muted before:mr-1.5 before:text-ink-faint before:content-['—']">
                  {u}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="eyebrow">
              {integration.status === "connected" ? "Configured" : "What is needed"}
            </div>
            <ul className="mt-1.5 flex flex-col gap-1">
              {integration.envVars.map((v) => {
                const missing = integration.missing.includes(v.name);
                return (
                  <li key={v.name} className="flex items-baseline gap-2 text-[12px]">
                    <span
                      aria-hidden
                      className={`mt-1 size-1.5 shrink-0 rounded-full ${missing ? "bg-warn" : "bg-good"}`}
                    />
                    <span>
                      <code className="font-mono text-[11.5px] text-ink">{v.name}</code>
                      {!v.required ? <span className="text-ink-faint"> (optional)</span> : null}
                      <span className="text-ink-muted"> — {v.description}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {integration.status !== "connected" ? (
          <details className="mt-4 border-t border-line pt-3">
            <summary className="cursor-pointer text-[12.5px] font-medium text-ink-muted hover:text-ink">
              How to connect {integration.name}
            </summary>
            <ol className="mt-2.5 flex flex-col gap-1.5">
              {integration.setupSteps.map((step, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-muted">
                  <span className="tabular shrink-0 font-medium text-ink-faint">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
            {integration.docsUrl ? (
              <a
                href={integration.docsUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2.5 inline-block text-[12px] text-brass hover:underline"
              >
                Provider documentation
              </a>
            ) : null}
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className={`mt-0.5 text-[13px] ${tone === "warn" ? "text-warn" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
