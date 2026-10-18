export const appName = "Semola";
export const appTagline = "Type-safe building blocks for real backends";
export const appDescription =
  "Zero-dependency TypeScript toolkit for Bun. Typed REST APIs with OpenAPI, Redis queues, pub/sub, ORM, durable workflows, caching, auth policies, i18n, and more.";
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
