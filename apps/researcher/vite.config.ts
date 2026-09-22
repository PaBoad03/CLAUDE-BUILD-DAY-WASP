import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  test: {
    environment: "node",
    // *.spec.ts on purpose: the root `npm test` (node --test) picks up *.test.ts and would choke on vitest imports.
    include: ["tests/**/*.spec.ts"],
  },
});
