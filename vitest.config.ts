import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // `server-only` throws when imported outside a React Server Component
    // context; in tests the modules under test are plain functions.
    // `next/headers` only exists inside a request, so the security tests drive
    // the real session code against a controllable cookie jar.
    alias: {
      "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url).pathname,
      "next/headers": new URL("./tests/stubs/next-headers.ts", import.meta.url).pathname,
    },
  },
});
