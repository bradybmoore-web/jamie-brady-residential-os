"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, Card, CardContent, PageTitle, buttonClasses } from "@/components/ui/primitives";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page]", error);
  }, [error]);

  return (
    <div className="px-4 py-16 lg:px-8">
      <div className="mx-auto max-w-lg">
        <p className="eyebrow">Something went wrong</p>
        <PageTitle className="mt-1.5">This screen could not load</PageTitle>
        <Card className="mt-5">
          <CardContent className="pt-5">
            <p className="text-[13px] leading-relaxed text-ink-muted">
              {error.message || "An unexpected error occurred."}
            </p>
            {error.digest ? (
              <p className="mt-2 font-mono text-[11.5px] text-ink-faint">Reference: {error.digest}</p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={reset}>
                Try again
              </Button>
              <Link href="/today" className={buttonClasses("secondary", "sm")}>
                Back to Today
              </Link>
            </div>
          </CardContent>
        </Card>
        <p className="mt-4 text-[12px] leading-relaxed text-ink-faint">
          If this keeps happening, check Settings for the state of your integrations — a workflow that depends on a
          service which is down will surface here.
        </p>
      </div>
    </div>
  );
}
