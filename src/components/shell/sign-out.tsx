"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/primitives";

export function SignOutButton({ variant = "icon" }: { variant?: "icon" | "labelled" }) {
  const [pending, startTransition] = useTransition();
  const signOutNow = () => startTransition(() => signOut());

  if (variant === "labelled") {
    return (
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={signOutNow}>
        <LogOut className="size-3.5" strokeWidth={1.75} aria-hidden />
        {pending ? "Signing out…" : "Sign out"}
      </Button>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={signOutNow}
      aria-label="Sign out"
      title="Sign out"
      className="inline-flex size-7 items-center justify-center rounded-[4px] text-ink-faint transition-colors hover:bg-surface-sunk hover:text-ink disabled:opacity-50"
    >
      <LogOut className="size-3.5" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
