"use client";

import { useActionState } from "react";
import { signInWithPasscode, signInWithSupabase, type LoginState } from "@/app/actions/auth";
import { Button, Input, Label, Select } from "@/components/ui/primitives";

interface Props {
  useSupabase: boolean;
  profiles: { id: string; name: string; title: string }[];
  warning: string | null;
}

export function LoginForm({ useSupabase, profiles, warning }: Props) {
  const action = useSupabase ? signInWithSupabase : signInWithPasscode;
  const [state, formAction, pending] = useActionState<LoginState, FormData>(action, {});

  return (
    <div>
      <p className="eyebrow">Residential OS</p>
      <h2 className="display mt-2 text-[26px] text-ink">Sign in</h2>
      <p className="mt-1.5 text-[13px] text-ink-muted">
        {useSupabase ? "Use your team account." : "Choose your name and enter the team passcode."}
      </p>

      <form action={formAction} className="mt-7 flex flex-col gap-4">
        {useSupabase ? (
          <>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
          </>
        ) : (
          <>
            <div>
              <Label htmlFor="profileId">Who are you?</Label>
              <Select id="profileId" name="profileId" className="h-9 w-full" required defaultValue={profiles[0]?.id}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.title ? ` — ${p.title}` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="passcode">Team passcode</Label>
              <Input id="passcode" name="passcode" type="password" autoComplete="off" required />
              <p className="mt-1.5 text-[11.5px] text-ink-faint">
                Set by <code className="font-mono">DEMO_PASSCODE</code>. Defaults to{" "}
                <code className="font-mono">residential</code>.
              </p>
            </div>
          </>
        )}

        {state.error ? (
          <p role="alert" className="rounded-[4px] bg-urgent-soft px-3 py-2 text-[12.5px] text-urgent">
            {state.error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" disabled={pending} className="mt-1 w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {warning ? (
        <p className="mt-6 rounded-[4px] border border-line-strong bg-warn-soft px-3 py-2.5 text-[12px] leading-relaxed text-warn">
          {warning}
        </p>
      ) : null}

      {!useSupabase ? (
        <p className="mt-6 text-[11.5px] leading-relaxed text-ink-faint">
          This deployment is running on seeded demo data with shared-passcode access. Connect Supabase before
          putting real client information in it — see the README.
        </p>
      ) : null}
    </div>
  );
}
