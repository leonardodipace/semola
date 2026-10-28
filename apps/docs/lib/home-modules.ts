import rootPackage from "../../../package.json";
import { source } from "@/lib/source";

const moduleBlurbs: Record<string, string> = {
  api: "Typed routes, OpenAPI, and a typed client",
  queue: "Redis jobs with retries and reclaim",
  pubsub: "Typed channels over Redis or in memory",
  cron: "Schedules in-process or at the OS level",
  workflow: "Multi-step jobs that resume after a crash",
  orm: "Typed tables, queries, and migrations",
  cache: "Typed Redis cache with TTL",
  policy: "Allow and forbid rules, forbid wins",
  i18n: "Translation keys checked at compile time",
  schema: "Standard Schema validation with JSON Schema output",
  errors: "Result tuples instead of nested try/catch",
  logging: "Prefixed loggers with console and file outputs",
  otel: "OTLP traces, metrics, and logs",
  prompts: "Interactive terminal prompts",
  cli: "Typed commands, arguments, and options",
  extra: "Retries with backoff and other small helpers",
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
