import rootPackage from "../../../package.json";
import { source } from "@/lib/source";

const moduleBlurbs: Record<string, string> = {
  api: "REST routes, OpenAPI, and a typed client from one definition",
  queue: "Redis jobs with retries, timeouts, and reclaim",
  pubsub: "Typed channels on Redis or in memory",
  cron: "In-process or OS-level schedules",
  workflow: "Multi-step work that resumes after a crash",
  orm: "Tables, queries, and migrations for SQLite and Postgres",
  cache: "Redis values with a TypeScript type and a TTL",
  policy: "Readable allow / forbid rules - forbid wins",
  i18n: "Translation keys the compiler can reject",
  schema: "Built-in Standard Schema with JSON Schema output",
  errors: "[error, data] tuples instead of nested try / catch",
  logging: "Prefixed loggers to console or files",
  otel: "OTLP traces, metrics, and logs over HTTP JSON",
  prompts: "Interactive prompts for terminal tools",
  cli: "Commands, flags, and options with schema validation",
  extra: "Backoff retries and other small helpers",
};

const DESCRIPTION_PREFIX = /^Semola [^-]+ - /;

type HomeModule = {
  pkg: string;
  href: string;
  blurb: string;
};

type HomeModuleGroup = {
  title: string;
  modules: HomeModule[];
};

const isPackageExport = (slug: string) => {
  return Object.hasOwn(rootPackage.exports, `./${slug}`);
};

const readBlurb = (slug: string, description: string | undefined) => {
  const blurb = moduleBlurbs[slug];

  if (blurb) return blurb;

  return (description ?? "").replace(DESCRIPTION_PREFIX, "");
};

export const getModuleGroups = () => {
  const groups: HomeModuleGroup[] = [];

  for (const node of source.getPageTree().children) {
    if (node.type === "separator") {
      groups.push({ title: String(node.name ?? ""), modules: [] });
      continue;
    }

    if (node.type !== "page") continue;

    const slug = node.url.split("/").pop() ?? "";

    if (!isPackageExport(slug)) continue;

    const page = source.getNodePage(node);

    groups.at(-1)?.modules.push({
      pkg: `semola/${slug}`,
      href: node.url,
      blurb: readBlurb(slug, page?.data.description),
    });
  }

  return groups.filter((group) => group.modules.length > 0);
};

export const listGridModules = () => {
  return getModuleGroups().flatMap((group) =>
    group.modules.map((module) => ({
      ...module,
      slug: module.pkg.replace("semola/", ""),
      group: group.title,
    })),
  );
};

export const listModulePackages = () => {
  return getModuleGroups().flatMap((group) =>
    group.modules.map((module) => module.pkg),
  );
};
