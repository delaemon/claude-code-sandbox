import { defineConfig } from "vite";

// Kept outside src/ deliberately: scripts/clock-boundary.mjs walks app/src and
// refuses clocks and randomness everywhere but main.ts. Build configuration is
// neither application code nor subject to that rule, and putting it under src
// would either weaken the check or force an exception into it.
export default defineConfig({
  base: "./",
  test: {
    // Tests live beside nothing -- app/tests -- so the boundary check walks a
    // source tree containing only the application it is making claims about.
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
