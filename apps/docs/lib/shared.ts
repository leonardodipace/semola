import rootPackage from "../../../package.json";

export const appName = "Semola";
export const packageVersion = rootPackage.version;
export const appTagline = "Type-safe backend toolkit, zero dependencies";
export const appDescription =
  "Semola replaces the usual backend stack with one zero-dependency TypeScript package: typed REST APIs and OpenAPI, Redis queues, durable workflows, SQL, auth, cache, and more - import only what you use.";
export const appOgLine =
  "APIs, queues, workflows, and SQL. One package. Empty dependencies field.";
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
