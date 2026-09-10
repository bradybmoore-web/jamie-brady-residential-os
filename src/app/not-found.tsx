import Link from "next/link";
import { buttonClasses } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="eyebrow">404</p>
        <h1 className="display mt-2 text-[26px] text-ink">That page does not exist</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
          The record may have been removed, or the link may be from an older version of the app.
        </p>
        <Link href="/today" className={`${buttonClasses("primary", "md")} mt-6`}>
          Back to Today
        </Link>
      </div>
    </main>
  );
}
