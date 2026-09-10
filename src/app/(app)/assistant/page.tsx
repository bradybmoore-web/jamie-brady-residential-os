import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { capabilities } from "@/lib/env";
import { toolNames } from "@/lib/ai/tools";
import { SUGGESTED_QUESTIONS } from "@/lib/workflows/assistant";
import { AssistantChat } from "@/components/assistant/chat";
import { Badge, PageTitle } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "AI Assistant" };
export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  await requireSession();
  const tools = toolNames();

  return (
    <div className="mx-auto max-w-4xl px-4 py-7 lg:px-8">
      <header>
        <p className="eyebrow">Ask anything</p>
        <PageTitle className="mt-1.5">AI Assistant</PageTitle>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-ink-faint">{tools.length} tools available:</span>
          {tools.slice(0, 6).map((t) => (
            <Badge key={t} tone="outline" className="normal-case tracking-normal">
              {t}
            </Badge>
          ))}
          <span className="text-[12px] text-ink-faint">and {tools.length - 6} more</span>
        </div>
      </header>

      <div className="mt-6">
        <AssistantChat suggestions={SUGGESTED_QUESTIONS} usingMockAI={!capabilities.anthropic} />
      </div>
    </div>
  );
}
