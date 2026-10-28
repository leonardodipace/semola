import rootPackage from "../../../package.json";

export const appName = "Semola";
export const packageVersion = rootPackage.version;
export const appTagline = "The type-safe backend toolkit for TypeScript";
export const appDescription =
  "Semola is a zero-dependency TypeScript backend toolkit with typed routes, OpenAPI, queues, durable workflows, an ORM, and more. Built for Bun.";
export const siteUrl = new URL(
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://semo.la",
).origin;
export const docsRoute = "/docs";
export const docsImageRoute = "/og/docs";
export const docsContentRoute = "/llms.mdx/docs";
export const homeOgImagePath = "/og/home";

export const gitConfig = {
  user: "leonardodipace",
  repo: "semola",
  branch: "main",
};

export const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
export const npmUrl = "https://www.npmjs.com/package/semola";
