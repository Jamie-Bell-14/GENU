import { defineConfig } from "vitest/config";

// RLS isolation suite: runs in node against a disposable Postgres database.
// Kept out of the default unit config so `npm test` needs no database.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["supabase/tests/**/*.test.ts"],
  },
});
