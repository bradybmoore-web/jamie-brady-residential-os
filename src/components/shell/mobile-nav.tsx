"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { SidebarNav } from "./sidebar";

/** The sidebar collapses behind a button below the `lg` breakpoint. */
export function MobileNav({ pendingApprovals }: { pendingApprovals: number }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close navigation" : "Open navigation"}
        className="inline-flex size-8 items-center justify-center rounded-[4px] border border-line-strong bg-surface text-ink-muted lg:hidden"
      >
        {open ? <X className="size-4" strokeWidth={1.75} /> : <Menu className="size-4" strokeWidth={1.75} />}
      </button>

      {open ? (
        <div className="fixed inset-0 top-[57px] z-40 overflow-y-auto border-t border-line bg-paper p-4 lg:hidden">
          <div onClick={() => setOpen(false)}>
            <SidebarNav pendingApprovals={pendingApprovals} />
          </div>
        </div>
      ) : null}
    </>
  );
}
