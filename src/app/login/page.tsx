import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { demoAuthWarning, getSession, listLoginProfiles } from "@/lib/auth/session";
import { capabilities } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/today");

  const profiles = capabilities.supabase ? [] : await listLoginProfiles();

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Left: the pitch. Restrained on purpose — this is a private tool. */}
      <section className="hidden flex-col justify-between bg-ink px-12 py-14 text-[#e9e5dd] lg:flex">
        <div>
          <p className="eyebrow text-[#a09883]">Moore Residential Group · Austin, Texas</p>
          <h1 className="display mt-6 max-w-md text-[42px] leading-[1.1] text-white">
            Everything that needs you today, in one place.
          </h1>
          <p className="mt-5 max-w-md text-[14px] leading-relaxed text-[#b8b2a5]">
            Not another CRM. An operating layer over the tools you already use, that reads the whole book of
            business each morning and tells you who needs you, why, and what to say.
          </p>
        </div>

        <dl className="grid max-w-md grid-cols-2 gap-x-8 gap-y-6 border-t border-[#33312d] pt-8">
          {[
            ["Prepared, not listed", "Drafts, briefs and openers ready before you ask."],
            ["Evidence, always", "Every recommendation cites the records behind it."],
            ["You approve", "Nothing goes to a client without your hand on it."],
            ["Your systems stay", "Cloze and ActivePipe keep doing their jobs."],
          ].map(([title, body]) => (
            <div key={title}>
              <dt className="text-[12.5px] font-semibold text-white">{title}</dt>
              <dd className="mt-1 text-[12.5px] leading-relaxed text-[#9c9689]">{body}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Right: the form. */}
      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-[360px]">
          <LoginForm
            useSupabase={capabilities.supabase}
            profiles={profiles.map((p) => ({ id: p.id, name: p.fullName, title: p.title ?? "" }))}
            warning={demoAuthWarning()}
          />
        </div>
      </section>
    </main>
  );
}
