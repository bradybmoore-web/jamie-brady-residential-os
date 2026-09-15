import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { getAuthState } from "@/lib/auth/session";
import { SignOutButton } from "@/components/shell/sign-out";
import { Card, CardContent, PageTitle } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Awaiting approval" };
export const dynamic = "force-dynamic";

/**
 * Shown to someone who has authenticated successfully but is not an approved
 * team member.
 *
 * This is the visible half of deny-by-default: creating a Supabase account is
 * not the same as being granted access to the business. Without this screen the
 * refusal looked like a bug — sign in, get bounced back to the sign-in page.
 */
export default async function PendingApprovalPage() {
  const state = await getAuthState();

  if (state.status === "authorized") redirect("/today");
  if (state.status === "anonymous") redirect("/login");

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-[460px]">
        <p className="eyebrow">Residential OS</p>
        <PageTitle className="mt-2">This account is not approved</PageTitle>

        <Card className="mt-6">
          <CardContent className="pt-5">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warn" strokeWidth={1.75} aria-hidden />
              <div>
                <p className="text-[13.5px] leading-relaxed text-ink">
                  You are signed in as{" "}
                  <strong className="font-medium">{state.email || "this account"}</strong>, but it has not been
                  granted access to Jamie &amp; Brady&rsquo;s data.
                </p>
                <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
                  Access is granted deliberately, one person at a time. Creating an account does not grant it. If
                  you should have access, ask Brady to approve this address.
                </p>
              </div>
            </div>

            <div className="mt-5 border-t border-line pt-4">
              <SignOutButton variant="labelled" />
            </div>
          </CardContent>
        </Card>

        <p className="mt-4 text-[11.5px] leading-relaxed text-ink-faint">
          If you reached this page by mistake, sign out and use the account that was approved for the team.
        </p>
      </div>
    </main>
  );
}
