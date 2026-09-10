import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { capabilities } from "@/lib/env";
import { BRAND_ICON } from "@/components/shell/nav";
import { SidebarNav } from "@/components/shell/sidebar";
import { MobileNav } from "@/components/shell/mobile-nav";
import { SignOutButton } from "@/components/shell/sign-out";
import { initials } from "@/lib/utils";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const store = await getStore();
  const actions = await store.listAIActions();
  const pendingApprovals = actions.filter((a) => a.status === "needs_review").length;
  const Brand = BRAND_ICON;

  return (
    <div className="min-h-dvh">
      {/* Top bar */}
      <header className="sticky top-0 z-50 border-b border-line bg-paper/90 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4 lg:px-5">
          <MobileNav pendingApprovals={pendingApprovals} />
          <Link href="/today" className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-[4px] bg-ink">
              <Brand className="size-3.5 text-[#e8d6b8]" strokeWidth={1.75} aria-hidden />
            </span>
            <span className="flex flex-col leading-none">
              <span className="display text-[15px] text-ink">Residential OS</span>
              <span className="text-[10.5px] tracking-[0.05em] text-ink-faint">Moore Residential Group</span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-3">
            {!capabilities.supabase ? (
              <span
                title="No Supabase connection. Running on seeded demo data held in memory."
                className="hidden items-center gap-1.5 rounded-[3px] border border-line-strong px-2 py-1 text-[11px] text-ink-muted sm:inline-flex"
              >
                <span className="size-1.5 rounded-full bg-warn" aria-hidden />
                Demo data
              </span>
            ) : null}
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-surface-sunk text-[11px] font-semibold text-ink-muted">
                {initials(session.fullName)}
              </span>
              <span className="hidden text-[13px] text-ink sm:inline">{session.fullName}</span>
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-[210px] shrink-0 overflow-y-auto border-r border-line px-2 py-5 lg:block">
          <SidebarNav pendingApprovals={pendingApprovals} />
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
