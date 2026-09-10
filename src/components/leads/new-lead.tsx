"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Card, Input, Label, Textarea } from "@/components/ui/primitives";
import { createLeadAction } from "@/app/actions/leads";

/**
 * Manual lead entry. Real leads arrive through Gmail and the website form once
 * those are connected, but the team also takes calls, and a lead that only
 * exists on a sticky note is not in the pipeline.
 */
export function NewLeadDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await createLeadAction({
        firstName: String(formData.get("firstName") ?? ""),
        lastName: String(formData.get("lastName") ?? ""),
        email: String(formData.get("email") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        source: String(formData.get("source") ?? ""),
        inquiryContent: String(formData.get("inquiryContent") ?? ""),
      });
      if (result.ok && result.data) {
        setOpen(false);
        router.push(`/leads/${result.data.id}`);
      } else if (!result.ok) {
        setError(result.error);
      }
    });
  };

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" strokeWidth={2} aria-hidden />
        Add Lead
      </Button>
    );
  }

  return (
    <Card className="w-full max-w-lg p-5">
      <h2 className="text-[15px] font-semibold text-ink">New lead</h2>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        Paste what they said. It will be classified, scored, and given a drafted reply.
      </p>

      <form action={submit} className="mt-4 flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" name="firstName" required />
          </div>
          <div>
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" name="lastName" required />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" />
          </div>
        </div>
        <div>
          <Label htmlFor="source">Source</Label>
          <Input id="source" name="source" placeholder="Referral — Greg Halvorsen" />
        </div>
        <div>
          <Label htmlFor="inquiryContent">What they said</Label>
          <Textarea id="inquiryContent" name="inquiryContent" rows={5} required />
        </div>

        {error ? <p className="text-[12.5px] text-urgent">{error}</p> : null}

        <div className="mt-1 flex gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Analysing…" : "Create and analyse"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
