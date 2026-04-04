import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    "lib/errors/index": "src/lib/errors/index.ts",
    "lib/cache/index": "src/lib/cache/index.ts",
    "lib/i18n/index": "src/lib/i18n/index.ts",
    "lib/policy/index": "src/lib/policy/index.ts",
    "lib/api/index": "src/lib/api/index.ts",
    "lib/queue/index": "src/lib/queue/index.ts",
    "lib/pubsub/index": "src/lib/pubsub/index.ts",
    "lib/cron/index": "src/lib/cron/index.ts",
    "lib/logging/index": "src/lib/logging/index.ts",
    "lib/prompts/index": "src/lib/prompts/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  unbundle: true,
});
