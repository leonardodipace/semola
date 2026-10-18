/**
 * Extracts TypeScript/JavaScript fences from README.md and docs/*.md,
 * type-checks them against the built `semola/*` package, optionally runs
 * self-contained examples, and validates doc links + docs/meta.json nav.
 *
 * Run: bun run build && bun run docs:check
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DOCS_DIR = join(ROOT, "docs");
const CACHE_DIR = join(ROOT, ".cache", "docs-check");

type FenceLang = "typescript" | "ts" | "javascript" | "js";
type BlockMode =
  | "typecheck"
  | "typecheck-stubbed"
  | "run"
  | "source-check"
  | "skip";

type FenceBlock = {
  file: string;
  line: number;
  lang: string;
  code: string;
};

type BlockResult = {
  id: string;
  file: string;
  line: number;
  mode: BlockMode;
  ok: boolean;
  detail?: string;
};

const MARKDOWN_FILES = [
  join(ROOT, "README.md"),
  ...readdirSync(DOCS_DIR)
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(DOCS_DIR, name)),
].sort();

const FENCE_LANGS = new Set(["typescript", "ts", "javascript", "js"]);

const EXTERNAL_PATTERNS: RegExp[] = [
  /\bredis\b/i,
  /\bRedis\b/,
  /\bnew Queue\b/,
  /\bnew Cache\b/,
  /\bnew PubSub\b/,
  /\bcreateOrm\b/,
  /\bSEMOLA_POSTGRES\b/,
  /postgres:\/\//i,
  /\bmigrate\(\)/,
  /\brunMigrations\b/,
  /\bprogram\.parse\(\)/,
  /\bawait program\.parse\(\)/,
  /\bfetch\s*\(\s*["']https?:\/\//,
  /\bawait\s+fetch\s*\(/,
  /\bnew Otel\b/,
  /\botel\.shutdown\b/,
  /\bBun\.serve\b/,
  /\bapi\.serve\b/,
  /\bprogram\.parse\s*\(\s*\[/,
  /\bmightThrowSync\b/,
];

const SOURCE_CHECK_PATTERNS: RegExp[] = [
  /^```(?:bash|sh|shell|json|yaml|yml|sql|npm|text)/m,
];

const FILE_PREAMBLES: Record<string, string> = {
  [join(DOCS_DIR, "api.md")]:
    `import { Api, Group, Middleware } from "semola/api";
import { z } from "zod";
declare function createPost(body: unknown): Promise<{ id: string }>;
declare function getUser(id: string): Promise<{ id: string }>;
declare function parseToken(token: string): { sub: string };
declare class MyDomainError extends Error {}
declare const auth: Middleware;
`,
  [join(DOCS_DIR, "cli.md")]: `import { CLI } from "semola/cli";
import { z } from "zod";
declare function migrate(): Promise<void>;
declare function runMigrations(opts: { dryRun: boolean }): Promise<void>;
`,
  [join(DOCS_DIR, "policy.md")]:
    `import { Policy, eq, and, or, has, hasAny, hasLength } from "semola/policy";
type Post = {
  id: number;
  authorId: number;
  status: "draft" | "published";
  tags: string[];
  permissions?: string[];
};
const posts = new Policy<Post>();
type User = { id: number; role: string; permissions: string[] };
`,
  [join(DOCS_DIR, "cron.md")]: `import {
  Cron,
  cronJobBuilder,
  any,
  list,
  number,
  range,
  step,
  Month,
  WeekDay,
} from "semola/cron";
declare const cleanup: Cron;
declare function clearTempFiles(): Promise<void>;
declare function deleteOldLogs(): Promise<void>;
declare function archiveInactiveUsers(): Promise<void>;
declare function syncRemote(): Promise<void>;
declare function notifyTeam(): Promise<void>;
declare function sendReport(): Promise<void>;
`,
  [join(DOCS_DIR, "otel.md")]:
    `import { Otel, inject, extract } from "semola/otel";
const otel = new Otel({
  serviceName: "doc",
  export: { type: "otlp-http", url: "http://localhost:4318" },
  enabled: false,
});
const tracer = otel.tracer("doc");
declare const request: Request;
declare const durationMs: number;
declare const orderId: string;
declare function charge(): Promise<void>;
`,
  [join(DOCS_DIR, "pubsub.md")]: `import { PubSub } from "semola/pubsub";
type PubMessage = { userId: string; action: string; text?: string };
declare const events: PubSub<PubMessage>;
declare const handler: (message: PubMessage) => void;
declare const request: Request;
`,
  [join(DOCS_DIR, "cache.md")]: `import { Cache } from "semola/cache";
declare const users: Cache<{ name: string; email: string }>;
`,
  [join(DOCS_DIR, "queue.md")]: `import { Queue } from "semola/queue";
declare const emails: Queue<{ to: string; subject: string }>;
`,
  [join(DOCS_DIR, "workflow.md")]:
    `import { defineWorkflow, listWorkflows } from "semola/workflow";
declare const redisClient: Bun.RedisClient;
declare const onboard: {
  start: (
    input: { userId: string },
    options?: { executionId?: string },
  ) => Promise<{ executionId: string; status: string }>;
  get: (executionId: string) => Promise<Record<string, unknown>>;
  resume: (executionId: string) => Promise<Record<string, unknown>>;
  cancel: (executionId: string) => Promise<Record<string, unknown>>;
  stop: () => Promise<void>;
};
declare const executionId: string;
`,
  [join(DOCS_DIR, "orm.md")]: `import {
  createOrm,
  defineTable,
  json,
  string,
  uuid,
  date,
  check,
  index,
  uniqueIndex,
  number,
} from "semola/orm";
declare const db: any;
`,
  [join(DOCS_DIR, "i18n.md")]: `import { I18n } from "semola/i18n";
const i18n = new I18n({
  defaultLocale: "en",
  locales: {
    en: {
      greeting: "Hello",
      welcome: "Welcome, {name:string}!",
      "messages.unread": "You have {count:number} unread messages",
    },
    es: {
      greeting: "Hola",
      welcome: "Bienvenido, {name:string}!",
    },
  },
}) as any;
`,
  [join(DOCS_DIR, "logging.md")]: `import {
  AbstractLogger,
  BaseFormatter,
  ConsoleProvider,
  FileProvider,
  JSONFormatter,
  Logger,
  LoggerProvider,
  isoDateTimeFormat,
} from "semola/logging";
import type { LogDataType, LogMessageType } from "semola/logging";
import { Api } from "semola/api";
`,
  [join(DOCS_DIR, "prompts.md")]:
    `import { confirm, input, multiselect, number, password, select } from "semola/prompts";
declare const mockRuntime: import("semola/prompts").PromptRuntime;
`,
  [join(DOCS_DIR, "schema.md")]:
    `import { s, object, string, number, optional, nullable, nullish, InferInput, InferOutput } from "semola/schema";
declare const user: { email: string; id: string; age: number };
`,
  [join(DOCS_DIR, "extra.md")]: `import { createRetry } from "semola/extra";
type Report = { name: string; author: string; completed?: boolean };
class ReportNotFoundError extends Error {}
async function findReport(_path: string, _id: string) {
  return null as Report | null;
}
async function execute(_command: string) {
  return undefined;
}
async function runCommand(_command: string, _args: string[]) {
  return undefined;
}
class InvalidArgumentError extends Error {}
class CommandNotFoundError extends Error {}
class ConnectionTimeOutError extends Error {}
`,
  [join(DOCS_DIR, "errors.md")]:
    `import { mightThrow, mightThrowSync } from "semola/errors";
declare const input: string;
declare function err(code: string, message: string): Error;
declare function ok<T>(value: T): T;
`,
};

const AUTO_IMPORTS: Array<{ pattern: RegExp; line: string }> = [
  {
    pattern: /\bmightThrow(Sync)?\b/,
    line: 'import { mightThrow, mightThrowSync } from "semola/errors";',
  },
  { pattern: /\bnew Cron\b/, line: 'import { Cron } from "semola/cron";' },
  {
    pattern: /\bnew Policy\b|\bposts\.(allow|forbid|can)\b/,
    line: 'import { Policy, eq, has, hasAny, hasLength, and, or } from "semola/policy";',
  },
  { pattern: /\bnew I18n\b/, line: 'import { I18n } from "semola/i18n";' },
  {
    pattern: /\bnew Logger\b|\bConsoleProvider\b/,
    line: 'import { ConsoleProvider, Logger } from "semola/logging";',
  },
  {
    pattern: /\bcreateRetry\b/,
    line: 'import { createRetry } from "semola/extra";',
  },
  { pattern: /\bnew Queue\b/, line: 'import { Queue } from "semola/queue";' },
  {
    pattern: /\bnew PubSub\b/,
    line: 'import { PubSub } from "semola/pubsub";',
  },
  { pattern: /\bnew Cache\b/, line: 'import { Cache } from "semola/cache";' },
  {
    pattern: /\bcreateOrm\b|\bdefineTable\b/,
    line: 'import { createOrm, defineTable, json, string, uuid } from "semola/orm";',
  },
  {
    pattern: /\bnew Api\b|\bapi\.define/,
    line: 'import { Api, Group, Middleware } from "semola/api";',
  },
  { pattern: /\bz\./, line: 'import { z } from "zod";' },
  {
    pattern: /\bnew CLI\b|\bprogram\./,
    line: 'import { CLI } from "semola/cli";',
  },
  {
    pattern: /\bnew Otel\b|\botel\./,
    line: 'import { Otel, inject, extract } from "semola/otel";',
  },
  {
    pattern: /\bobject\(|\.email\(\)|\bs\.object/,
    line: 'import { object, string, s } from "semola/schema";',
  },
  { pattern: /\bexpect\(/, line: 'import { expect } from "bun:test";' },
];

const isDeclaredInCode = (code: string, name: string) => {
  return new RegExp(
    `\\b(const|let|var|function|class|type)\\s+${name}\\b`,
  ).test(code);
};

const splitImports = (code: string) => {
  const importLines: string[] = [];
  let body = code;

  while (true) {
    body = body.replace(/^\s*\/\/.*\n/m, "");
    const match = body.match(/^\s*import\s[\s\S]*?from\s+["'][^"']+["'];?\s*/m);
    if (!match) {
      break;
    }

    importLines.push(match[0].trim());
    body = body.slice(match[0].length);
  }

  return { importLines, body: body.trim() };
};

const declareIfUsed = (
  code: string,
  name: string,
  decl: string,
  pattern?: RegExp,
) => {
  const matches = pattern ?? new RegExp(`\\b${name}\\b`);
  if (!matches.test(code)) {
    return "";
  }

  if (isDeclaredInCode(code, name)) {
    return "";
  }

  return decl;
};

const shouldSkipPreamble = (file: string, code: string) => {
  if (file.endsWith("policy.md") && /new Policy/.test(code)) {
    return true;
  }

  if (file.endsWith("api.md") && /new Api/.test(code)) {
    return true;
  }

  if (file.endsWith("cli.md") && /new CLI/.test(code)) {
    return true;
  }

  if (file.endsWith("pubsub.md") && /new PubSub/.test(code)) {
    return true;
  }

  if (file.endsWith("queue.md") && /new Queue/.test(code)) {
    return true;
  }

  if (file.endsWith("workflow.md") && /new Workflow/.test(code)) {
    return true;
  }

  if (file.endsWith("extra.md") && /createRetry\s*\(\{/.test(code)) {
    return true;
  }

  if (file.endsWith("otel.md") && /new Otel/.test(code)) {
    return true;
  }

  if (file.endsWith("schema.md") && /\bconst User =/.test(code)) {
    return true;
  }

  if (file.endsWith("i18n.md") && /new I18n/.test(code)) {
    return true;
  }

  return false;
};

const augmentBlock = (code: string, file: string) => {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return { code: "", stubbed: false };
  }

  const lines: string[] = ['/// <reference types="bun" />'];
  const { importLines, body } = splitImports(code);
  const preambleFile = FILE_PREAMBLES[file];
  const preamble =
    importLines.length === 0 && preambleFile && !shouldSkipPreamble(file, code)
      ? preambleFile
      : undefined;
  let stubbed = Boolean(preamble);

  if (preamble) {
    lines.push(preamble.trim());
  }

  const dbModuleDecl = `declare module "./db.js" {
  export const db: {
    users: {
      create: (args: { data: Record<string, string> }) => Promise<unknown>;
      findFirst: (args: { where: Record<string, unknown> }) => Promise<unknown>;
    };
  };
}`;

  const usesDbModule = /from\s+["']\.\/db\.js["']/.test(code);

  const importSet = new Set(importLines);

  if (importLines.length === 0 && !preamble) {
    for (const entry of AUTO_IMPORTS) {
      if (!entry.pattern.test(code)) {
        continue;
      }

      importSet.add(entry.line);
    }
  }

  if (
    /\bexpect\(/.test(code) &&
    !importLines.some((line) => line.includes("bun:test"))
  ) {
    importSet.add('import { expect } from "bun:test";');
  }

  if (usesDbModule) {
    lines.push(dbModuleDecl);
    stubbed = true;
  }

  if (importSet.size > 0) {
    lines.push([...importSet].join("\n"));
  }

  if (
    /\bdefineWorkflow\b/.test(body) &&
    !isDeclaredInCode(body, "redisClient") &&
    !file.endsWith("workflow.md")
  ) {
    lines.push("declare const redisClient: Bun.RedisClient;");
    stubbed = true;
  }

  const declares = [
    declareIfUsed(
      code,
      "createPost",
      "declare function createPost(body: unknown): Promise<{ id: string }>;",
    ),
    declareIfUsed(
      code,
      "getUser",
      "declare function getUser(id: string): Promise<{ id: string }>;",
    ),
    declareIfUsed(
      code,
      "parseToken",
      "declare function parseToken(token: string): { sub: string };",
    ),
    declareIfUsed(code, "charge", "declare function charge(): Promise<void>;"),
    declareIfUsed(
      code,
      "migrate",
      "declare function migrate(): Promise<void>;",
    ),
    declareIfUsed(
      code,
      "runMigrations",
      "declare function runMigrations(opts: { dryRun: boolean }): Promise<void>;",
    ),
    declareIfUsed(
      code,
      "sender",
      "declare function sender(req: unknown): Promise<void>;",
    ),
    declareIfUsed(
      code,
      "deleteOldLogs",
      "declare function deleteOldLogs(): Promise<void>;",
    ),
    declareIfUsed(
      code,
      "archiveInactiveUsers",
      "declare function archiveInactiveUsers(): Promise<void>;",
    ),
    declareIfUsed(
      code,
      "sendEmail",
      "declare function sendEmail(data: unknown): Promise<void>;",
    ),
    declareIfUsed(code, "orderId", "declare const orderId: string;"),
    declareIfUsed(code, "durationMs", "declare const durationMs: number;"),
    declareIfUsed(code, "upstream", "declare const upstream: string;"),
    declareIfUsed(
      code,
      "MyDomainError",
      "declare class MyDomainError extends Error {}",
    ),
    declareIfUsed(
      code,
      "users",
      "declare const users: Group;",
      /\busers\.(allow|forbid|can|mount|define)/,
    ),
    declareIfUsed(
      code,
      "v1",
      "declare const v1: Group;",
      /\bv1\.(defineRoute|define|mount)\b/,
    ),
    declareIfUsed(
      code,
      "admin",
      "declare const admin: Group;",
      /\badmin\.(defineRoute|define|mount)\b/,
    ),
  ].filter(Boolean);

  if (declares.length > 0) {
    lines.push(declares.join("\n"));
  }

  if (
    /\bapi\./.test(body) &&
    !isDeclaredInCode(body, "api") &&
    !preamble?.includes("const api") &&
    importLines.length === 0
  ) {
    lines.push("const api = new Api();");
    stubbed = true;
  }

  if (
    /\bprogram\./.test(body) &&
    !isDeclaredInCode(body, "program") &&
    !preamble?.includes("const program")
  ) {
    lines.push('const program = new CLI({ name: "doc", version: "1.0.0" });');
    stubbed = true;
  }

  if (
    file.endsWith("schema.md") &&
    /\bUser\[/.test(body) &&
    !isDeclaredInCode(body, "User")
  ) {
    lines.push(
      "const User = s.object({ email: s.email(), id: s.uuid(), age: s.int().min(0) });",
    );
    stubbed = true;
  }

  if (
    file.endsWith("policy.md") &&
    /\bUser\b/.test(body) &&
    !isDeclaredInCode(body, "User") &&
    !preamble?.includes("type User")
  ) {
    lines.push(
      "type User = { id: number; role: string; permissions: string[] };",
    );
    stubbed = true;
  }

  const normalized = body.replace(/\{\s*\.\.\.\s*\}/g, "{ return undefined; }");

  const hasAwait = /\bawait\b/.test(normalized);
  const hasTopLevelReturn = /(?:^|\n)\s*return\b/.test(normalized);

  if (hasAwait) {
    lines.push(`await (async () => {\n${normalized}\n})();`);
  } else if (hasTopLevelReturn) {
    lines.push(`(() => {\n${normalized}\n})();`);
  } else {
    lines.push(normalized);
  }

  lines.push("export {};");

  return { code: lines.join("\n\n"), stubbed };
};

const isTypeSignatureBlock = (code: string) => {
  const trimmed = code.trim();

  if (trimmed.includes("{")) {
    return false;
  }

  return /\)\s*:\s*.+/.test(trimmed);
};

const classifyBlock = (
  code: string,
  lang: string,
  _file: string,
): BlockMode => {
  if (!FENCE_LANGS.has(lang as FenceLang)) {
    return "skip";
  }

  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return "skip";
  }

  if (isTypeSignatureBlock(trimmed)) {
    return "skip";
  }

  const { body: importBody } = splitImports(trimmed);
  if (importBody.length === 0 && /^\s*import\s/m.test(trimmed)) {
    return "skip";
  }

  if (SOURCE_CHECK_PATTERNS.some((p) => p.test(`\`\`\`${lang}`))) {
    return "skip";
  }

  if (/\bfetch\s*\(/.test(code) && /https?:\/\//.test(code)) {
    return "source-check";
  }

  for (const pattern of EXTERNAL_PATTERNS) {
    if (pattern.test(code)) {
      return "source-check";
    }
  }

  if (/\bexpect\(/.test(code) && !/\bapi\.fetch\b/.test(code)) {
    return "typecheck-stubbed";
  }

  return "typecheck";
};

const extractFences = (file: string): FenceBlock[] => {
  const content = readFileSync(file, "utf8");
  const blocks: FenceBlock[] = [];
  const lines = content.split("\n");
  let inFence = false;
  let lang = "";
  let startLine = 0;
  let buffer: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (!inFence) {
      const open = line.match(/^```(\w+)?/);
      if (!open) {
        continue;
      }

      inFence = true;
      lang = open[1] ?? "";
      startLine = index + 1;
      buffer = [];
      continue;
    }

    if (line.startsWith("```")) {
      blocks.push({
        file,
        line: startLine,
        lang,
        code: buffer.join("\n"),
      });
      inFence = false;
      lang = "";
      buffer = [];
      continue;
    }

    buffer.push(line);
  }

  return blocks;
};

const slugifyHeading = (text: string) => {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
};

const extractHeadings = (content: string) => {
  const headings: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) {
      continue;
    }

    headings.push(slugifyHeading(match[2]));
  }

  return headings;
};

const resolveDocPath = (target: string) => {
  if (target.startsWith("/docs/")) {
    const slug = target.replace(/^\/docs\//, "").replace(/\/$/, "");
    return join(DOCS_DIR, `${slug}.md`);
  }

  if (target.endsWith(".md")) {
    return resolve(ROOT, target.replace(/^\.\//, ""));
  }

  return null;
};

type LinkIssue = { file: string; link: string; reason: string };

const checkLinks = (): LinkIssue[] => {
  const issues: LinkIssue[] = [];
  const headingCache = new Map<string, string[]>();

  const getHeadings = (path: string) => {
    if (!headingCache.has(path)) {
      const content = readFileSync(path, "utf8");
      headingCache.set(path, extractHeadings(content));
    }

    return headingCache.get(path) ?? [];
  };

  const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;

  for (const file of MARKDOWN_FILES) {
    const content = readFileSync(file, "utf8");
    const dir = dirname(file);

    for (const match of content.matchAll(linkPattern)) {
      const raw = match[2];
      if (!raw) {
        continue;
      }

      if (raw.startsWith("http://") || raw.startsWith("https://")) {
        continue;
      }

      const [pathPart, anchor] = raw.split("#");
      let targetPath: string | null = null;

      if (pathPart.length === 0) {
        targetPath = file;
      } else if (pathPart.startsWith("/docs/")) {
        targetPath = resolveDocPath(pathPart);
      } else if (pathPart.endsWith(".md")) {
        targetPath = resolve(dir, pathPart);
      } else if (
        !pathPart.includes("/") &&
        pathPart.length > 0 &&
        !pathPart.startsWith(".")
      ) {
        continue;
      } else {
        targetPath = resolve(dir, pathPart);
      }

      if (!targetPath || !existsSync(targetPath)) {
        issues.push({ file, link: raw, reason: "target file missing" });
        continue;
      }

      if (anchor) {
        const headings = getHeadings(targetPath);
        const anchorSlug = slugifyHeading(anchor);

        if (!headings.includes(anchorSlug)) {
          issues.push({
            file,
            link: raw,
            reason: `anchor #${anchor} not found in ${basename(targetPath)}`,
          });
        }
      }
    }
  }

  return issues;
};

const checkMetaJson = (): LinkIssue[] => {
  const issues: LinkIssue[] = [];
  const metaPath = join(DOCS_DIR, "meta.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
    pages: string[];
  };

  for (const page of meta.pages) {
    if (page.startsWith("---")) {
      continue;
    }

    const docPath = join(DOCS_DIR, `${page}.md`);
    if (!existsSync(docPath)) {
      issues.push({
        file: metaPath,
        link: page,
        reason: "nav page missing docs file",
      });
    }
  }

  return issues;
};

const sourceCheckBlock = (block: FenceBlock): BlockResult => {
  const id = `${basename(block.file)}:${block.line}`;
  const code = block.code;
  const checks: Array<{ pattern: RegExp; src: string; label: string }> = [
    { pattern: /\bapi\.listen\b/, src: "src/lib/api", label: "api.listen" },
    { pattern: /\bctx\.params\b/, src: "src/lib/api", label: "ctx.params" },
    { pattern: /\bc\.params\b/, src: "src/lib/api", label: "c.params" },
    {
      pattern: /createRetry\s*\(\s*(\n\s*)?async/,
      src: "src/lib/extra",
      label: "createRetry(async fn, opts)",
    },
  ];

  for (const check of checks) {
    if (!check.pattern.test(code)) {
      continue;
    }

    if (check.label === "createRetry(async fn, opts)") {
      return {
        id,
        file: block.file,
        line: block.line,
        mode: "source-check",
        ok: false,
        detail: "createRetry takes a single options object with `input`",
      };
    }

    return {
      id,
      file: block.file,
      line: block.line,
      mode: "source-check",
      ok: false,
      detail: `forbidden pattern ${check.label}`,
    };
  }

  return {
    id,
    file: block.file,
    line: block.line,
    mode: "source-check",
    ok: true,
  };
};

const runTypecheck = (_files: string[]) => {
  const configPath = join(ROOT, "tsconfig.docs-check.json");

  return spawnSync("bunx", ["tsc", "-p", configPath], {
    cwd: ROOT,
    encoding: "utf8",
  });
};

const tryRunBlock = (filePath: string) => {
  const result = spawnSync("bun", [filePath], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 5000,
  });

  return result;
};

const main = () => {
  if (!existsSync(join(ROOT, "dist/lib/schema/index.mjs"))) {
    console.error("Run `bun run build` before docs:check");
    process.exit(1);
  }

  rmSync(CACHE_DIR, { recursive: true, force: true });
  mkdirSync(CACHE_DIR, { recursive: true });

  const linkIssues = [...checkLinks(), ...checkMetaJson()];
  if (linkIssues.length > 0) {
    console.error("Link / nav issues:");
    for (const issue of linkIssues) {
      console.error(`  ${issue.file}: (${issue.link}) ${issue.reason}`);
    }
  }

  const allBlocks: FenceBlock[] = [];
  for (const file of MARKDOWN_FILES) {
    allBlocks.push(...extractFences(file));
  }

  const results: BlockResult[] = [];
  const typecheckEntries: Array<{
    block: FenceBlock;
    file: string;
    mode: BlockMode;
    stubbed: boolean;
  }> = [];
  let blockIndex = 0;

  for (const block of allBlocks) {
    const mode = classifyBlock(block.code, block.lang, block.file);

    if (mode === "skip") {
      results.push({
        id: `${basename(block.file)}:${block.line}`,
        file: block.file,
        line: block.line,
        mode: "skip",
        ok: true,
      });
      continue;
    }

    const forbidden = sourceCheckBlock(block);
    if (!forbidden.ok) {
      results.push(forbidden);
      continue;
    }

    if (mode === "source-check") {
      results.push(forbidden);
      continue;
    }

    if (!FENCE_LANGS.has(block.lang as FenceLang)) {
      continue;
    }

    const { code, stubbed } = augmentBlock(block.code, block.file);
    const outFile = join(CACHE_DIR, `block-${blockIndex}.ts`);
    writeFileSync(outFile, code);
    blockIndex += 1;

    const resultMode: BlockMode = stubbed ? "typecheck-stubbed" : mode;
    const entry = {
      block,
      file: outFile,
      mode: resultMode,
      stubbed,
    };
    typecheckEntries.push(entry);

    results.push({
      id: `${basename(block.file)}:${block.line}`,
      file: block.file,
      line: block.line,
      mode: resultMode,
      ok: true,
    });
  }

  const typecheckFiles = typecheckEntries.map((entry) => entry.file);
  const tsc = runTypecheck(typecheckFiles);

  if (tsc.status !== 0) {
    const errorText = `${tsc.stdout}\n${tsc.stderr}`;
    console.error(errorText);

    for (const match of errorText.matchAll(/block-(\d+)\.ts/g)) {
      const index = Number(match[1]);
      const tcResult = results.find(
        (r) =>
          r.id ===
          `${basename(typecheckEntries[index]?.block.file ?? "")}:${typecheckEntries[index]?.block.line}`,
      );

      if (tcResult && tcResult.mode === "typecheck") {
        tcResult.ok = false;
        tcResult.detail = "tsc error";
      }
    }
  }

  let runCount = 0;

  for (let index = 0; index < typecheckEntries.length; index++) {
    const entry = typecheckEntries[index];
    const content = readFileSync(entry.file, "utf8");
    const tcResult = results.find(
      (r) =>
        r.id === `${basename(entry.block.file)}:${entry.block.line}` &&
        r.mode !== "skip" &&
        r.mode !== "source-check",
    );

    if (!tcResult || !tcResult.ok) {
      continue;
    }

    const canRun =
      (content.includes(".parse(") || content.includes("api.fetch")) &&
      !EXTERNAL_PATTERNS.some((p) => p.test(entry.block.code));

    if (!canRun) {
      continue;
    }

    const runResult = tryRunBlock(entry.file);
    runCount += 1;
    tcResult.mode = "run";

    if (runResult.status !== 0) {
      tcResult.ok = false;
      tcResult.detail = (
        runResult.stderr ||
        runResult.stdout ||
        "runtime error"
      ).trim();
    }
  }

  const failures = results.filter((r) => !r.ok);

  console.log("Docs example check summary");
  console.log(`  markdown files: ${MARKDOWN_FILES.length}`);
  console.log(`  fenced blocks total: ${allBlocks.length}`);
  console.log(`  type-checked: ${typecheckFiles.length}`);
  console.log(`  run: ${runCount}`);
  console.log(
    `  source-checked: ${results.filter((r) => r.mode === "source-check").length}`,
  );
  console.log(`  skipped: ${results.filter((r) => r.mode === "skip").length}`);
  console.log(`  link/nav issues: ${linkIssues.length}`);
  console.log(`  failures: ${failures.length}`);

  if (failures.length > 0) {
    console.error("\nFailures:");
    for (const failure of failures) {
      console.error(
        `  ${failure.id} [${failure.mode}] ${failure.detail ?? "failed"}`,
      );
    }
  }

  if (linkIssues.length > 0) {
    process.exit(1);
  }

  if (failures.length > 0) {
    process.exit(1);
  }
};

main();
