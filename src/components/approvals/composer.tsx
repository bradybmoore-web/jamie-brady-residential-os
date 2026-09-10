"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, Input, Label, Textarea } from "@/components/ui/primitives";
import { createDraftAction } from "@/app/actions/approvals";

export function DraftComposer({
  contactId,
  leadId,
  recipientName,
  recipientEmail,
  initialTitle,
  initialBody,
}: {
  contactId?: string;
  leadId?: string;
  recipientName: string;
  recipientEmail: string;
  initialTitle: string;
  initialBody: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await createDraftAction({
        title: String(formData.get("title") ?? ""),
        subject: String(formData.get("subject") ?? ""),
        body: String(formData.get("body") ?? ""),
        recipient: String(formData.get("recipient") ?? ""),
        contactId,
        leadId,
      });
      if (result.ok) router.push("/approvals");
      else setError(result.error);
    });
  };

  return (
    <Card>
      <CardContent className="pt-5">
        <form action={submit} className="flex flex-col gap-4">
          {recipientName ? (
            <p className="text-[12.5px] text-ink-muted">
              To <span className="font-medium text-ink">{recipientName}</span>
            </p>
          ) : null}

          <div>
            <Label htmlFor="recipient">Recipient email</Label>
            <Input id="recipient" name="recipient" type="email" defaultValue={recipientEmail} />
          </div>

          <div>
            <Label htmlFor="title">Internal label</Label>
            <Input id="title" name="title" defaultValue={initialTitle} required />
          </div>

          <div>
            <Label htmlFor="subject">Subject</Label>
            <Input id="subject" name="subject" defaultValue={recipientName ? `Following up` : ""} />
          </div>

          <div>
            <Label htmlFor="body">Message</Label>
            <Textarea id="body" name="body" rows={12} defaultValue={initialBody} required className="font-sans" />
          </div>

          {error ? <p className="text-[12.5px] text-urgent">{error}</p> : null}

          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving…" : "Save to approvals"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
