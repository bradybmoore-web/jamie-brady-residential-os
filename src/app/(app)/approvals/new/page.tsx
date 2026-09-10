import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { DraftComposer } from "@/components/approvals/composer";
import { PageTitle } from "@/components/ui/primitives";
import { contactName, leadName } from "@/lib/types";

export const metadata: Metadata = { title: "New draft" };
export const dynamic = "force-dynamic";

export default async function NewDraftPage({
  searchParams,
}: {
  searchParams: Promise<{ contactId?: string; leadId?: string; title?: string; body?: string }>;
}) {
  await requireSession();
  const params = await searchParams;
  const store = await getStore();

  const contact = params.contactId ? await store.getContact(params.contactId) : null;
  const lead = params.leadId ? await store.getLead(params.leadId) : null;

  const recipientName = contact ? contactName(contact) : lead ? leadName(lead) : "";
  const recipientEmail = contact?.email ?? lead?.email ?? "";

  return (
    <div className="mx-auto max-w-2xl px-4 py-7 lg:px-8">
      <Link href="/approvals" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
        Approvals
      </Link>

      <header className="mt-4">
        <p className="eyebrow">Compose</p>
        <PageTitle className="mt-1.5">New draft</PageTitle>
        <p className="mt-1.5 text-[13.5px] text-ink-muted">
          This goes to the approval queue. Nothing is sent from here.
        </p>
      </header>

      <div className="mt-6">
        <DraftComposer
          contactId={params.contactId}
          leadId={params.leadId}
          recipientName={recipientName}
          recipientEmail={recipientEmail}
          initialTitle={params.title ?? (recipientName ? `Email ${recipientName}` : "Draft email")}
          initialBody={params.body ?? ""}
        />
      </div>
    </div>
  );
}
