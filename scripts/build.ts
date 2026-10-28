import { $ } from "bun";

await $`tsdown`;

if (process.env.WORKERS_CI === "1") {
  await $`bun run docs:cf-build`;
}
