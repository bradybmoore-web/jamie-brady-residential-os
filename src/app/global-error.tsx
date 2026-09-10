"use client";

/**
 * Last-resort boundary. It replaces the root layout, so it cannot use anything
 * from the design system — it renders its own minimal markup.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#faf9f7", color: "#1c1b19", margin: 0 }}>
        <main style={{ maxWidth: 480, margin: "0 auto", padding: "96px 24px" }}>
          <p style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "#8a867e" }}>
            Residential OS
          </p>
          <h1 style={{ fontSize: 26, fontWeight: 400, margin: "12px 0 0" }}>The application could not start</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#56534d" }}>
            {error.message || "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20,
              padding: "8px 14px",
              fontSize: 13,
              borderRadius: 4,
              border: "none",
              background: "#1c1b19",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
