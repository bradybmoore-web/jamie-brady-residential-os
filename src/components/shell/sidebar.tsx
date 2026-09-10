"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_SECTIONS } from "./nav";

export function SidebarNav({ pendingApprovals }: { pendingApprovals: number }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-col gap-5">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <div className="eyebrow px-3 pb-1.5">{section.label}</div>
          <ul className="flex flex-col gap-px">
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              const badge = item.href === "/approvals" && pendingApprovals > 0 ? pendingApprovals : null;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-[4px] px-3 py-1.5 text-[13px] transition-colors",
                      active
                        ? "bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(28,27,25,0.06)]"
                        : "text-ink-muted hover:bg-surface/70 hover:text-ink",
                    )}
                  >
                    <Icon
                      aria-hidden
                      className={cn("size-4 shrink-0", active ? "text-brass" : "text-ink-faint group-hover:text-ink-muted")}
                      strokeWidth={1.75}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {badge ? (
                      <span className="tabular rounded-[3px] bg-brass-soft px-1 py-px text-[10px] font-semibold text-brass">
                        {badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
