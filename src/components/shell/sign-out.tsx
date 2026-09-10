"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/actions/auth";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => signOut())}
      aria-label="Sign out"
      title="Sign out"
      className="inline-flex size-7 items-center justify-center rounded-[4px] text-ink-faint transition-colors hover:bg-surface-sunk hover:text-ink disabled:opacity-50"
    >
      <LogOut className="size-3.5" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
