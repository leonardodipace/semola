/**
 * Type-check and optionally run TS/JS fences from README.md and docs/*.md.
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
type BlockMode = "typecheck" | "run" | "skip";

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
  skipReason?: string;
};

const MARKDOWN_FILES = [
  join(ROOT, "README.md"),
  ...readdirSync(DOCS_DIR)
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(DOCS_DIR, name)),
].sort();

const FENCE_LANGS = new Set(["typescript", "ts", "javascript", "js"]);

const DB_STUB_JS = `export const db = {
  users: {
    async create(_args) { return {}; },
    async findFirst(_args) { return null; },
    async findMany(_args) { return []; },
    async update(_args) { return {}; },
    async deleteMany(_args) { return { count: 0 }; },
  },
  posts: {
    async findMany(_args) { return []; },
    async deleteMany(_args) { return { count: 0 }; },
  },
  async $transaction(fn) {
    return fn(db);
  },
  $raw: {
    async unsafe(_sql) {
      return [];
    },
  },
  async $ping() {},
};
`;

const DB_STUB_DTS = `type OrmRow = Record<string, unknown> & {
  author?: { email?: string };
};
type OrmTable = {
  create: (args: Record<string, unknown>) => Promise<OrmRow>;
  findFirst: (args?: Record<string, unknown>) => Promise<OrmRow | null>;
  findMany: (args?: Record<string, unknown>) => Promise<OrmRow[]>;
  update: (args: Record<string, unknown>) => Promise<OrmRow>;
  delete: (args: Record<string, unknown>) => Promise<OrmRow>;
  deleteMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
};
export declare const db: {
  users: OrmTable;
  posts: OrmTable;
  $transaction: <T>(fn: (tx: typeof db) => Promise<T>) => Promise<T>;
  $raw: { unsafe: (sql: string) => Promise<unknown> };
  $ping: () => Promise<void>;
};
`;

/** Blocks that must not be executed (external services, OS cron, network, servers). */
const RUN_SKIP_PATTERNS: RegExp[] = [
  /\bredis\b/i,
  /\bnew Queue\b/,
  /\bnew Cache\b/,
  /\bnew PubSub\b/,
  /\bevents\.(publish|subscribe|unsubscribe|listen)\b/,
  /\bcreateOrm\b/,
  /\bSEMOLA_POSTGRES\b/,
  /postgres:\/\//i,
  /\brunMigrations\b/,
  /\bmigrate\s*\(/,
  /\bfetch\s*\(/,
  /\bBun\.serve\b/,
  /\bapi\.serve\s*\(/,
  /\bnew CronOS\b/,
  /\bCronOS\b/,
  /\bCronDistributed\b/,
  /\botel\.shutdown\b/,
  /\bdefineWorkflow\b/,
  /from\s+["']\.\/db\.js["']/,
  /\bprogram\.parse\s*\(/,
  /\bBun\.write\b/,
  /\bnew Otel\b/,
  /\b(input|select|confirm|password|multiselect)\s*\(/,
  /from\s+["']semola\/prompts["']/,
];

const AUTO_IMPORTS: Array<{
  pattern: RegExp;
  line: string;
  skipWhen?: RegExp;
}> = [
  {
    pattern: /\bmightThrow(Sync)?\b|\bok\s*\(|\berr\s*\(/,
    line: 'import { mightThrow, mightThrowSync, ok, err } from "semola/errors";',
  },
  {
    pattern: /\bcronJobBuilder\b|\bnew Cron\b|\bCronOS\b|\bCronDistributed\b/,
    line: 'import { Cron, CronOS, CronDistributed, cronJobBuilder, any, list, number, range, step, Month, WeekDay } from "semola/cron";',
  },
  {
    pattern:
      /\bnew Policy\b|\bposts\.(allow|forbid|can)\b|\bpolicy\.(allow|forbid|can)\b/,
    line: 'import { Policy, eq, has, hasAny, hasLength, and, or } from "semola/policy";',
  },
  {
    pattern: /\bnew I18n\b|\bi18n\./,
    line: 'import { I18n } from "semola/i18n";',
  },
  {
    pattern:
      /\bnew Logger\b|\bConsoleProvider\b|\bAbstractLogger\b|\bLoggerProvider\b|\bFileProvider\b|\bJSONFormatter\b|\bBaseFormatter\b/,
    line: 'import { AbstractLogger, BaseFormatter, ConsoleProvider, FileProvider, JSONFormatter, Logger, LoggerProvider, isoDateTimeFormat, type LogDataType, type LogMessageType } from "semola/logging";',
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
    line: 'import { createOrm, defineTable, json, string, uuid, date, check, index, uniqueIndex, number } from "semola/orm";',
    skipWhen: /from\s+["']semola\/orm["']/,
  },
  {
    pattern: /\bnew Api\b|\bapi\.|new Group\b|\bnew Middleware\b/,
    line: 'import { Api, Group, Middleware } from "semola/api";',
  },
  { pattern: /\bz\./, line: 'import { z } from "zod";' },
  {
    pattern: /\bnew CLI\b|\bprogram\b/,
    line: 'import { CLI } from "semola/cli";',
  },
  {
    pattern:
      /\bnew Otel\b|\binject\b|\bextract\b|\botel\.|\btracer\.|\bmeter\./,
    line: 'import { Otel, inject, extract } from "semola/otel";',
  },
  {
    pattern:
      /\bInfer(Input|Output)\b|\bs\.object\b|\bobject\(|\boptional\(|\bnullable\(|\bnullish\(|\bnumber\(\)\.refine/,
    line: 'import { s, object, string, number, optional, nullable, nullish, InferInput, InferOutput } from "semola/schema";',
    skipWhen: /from\s+["']semola\/orm["']/,
  },
  {
    pattern: /\bdefineWorkflow\b|\blistWorkflows\b/,
    line: 'import { defineWorkflow, listWorkflows } from "semola/workflow";',
  },
  {
    pattern:
      /\b(?:await\s+)?(?:confirm|multiselect|password|select|input)\s*\(|\bnumber\s*\(\s*\{/,
    line: 'import { confirm, input, multiselect, number, password, select } from "semola/prompts";',
  },
  { pattern: /\bexpect\(/, line: 'import { expect } from "bun:test";' },
];

/** User-land symbols docs reference without defining in the same fence. */
const USER_DECLARATIONS: Array<{
  pattern: RegExp;
  decl: string;
  skipWhen?: RegExp;
}> = [
  {
    pattern: /\bcreatePost\b/,
    decl: "declare function createPost(body: unknown): Promise<{ id: string }>;",
  },
  {
    pattern: /const\s+\[error,\s*\w+\]\s*=\s*await\s+getUser/,
    decl: `declare function getUser(id: string): Promise<
  readonly [{ type: string; message: string }, null] | [null, Record<string, unknown>]
>;`,
  },
  {
    pattern: /\bgetUser\b/,
    decl: "declare function getUser(id: string): Promise<{ id: string }>;",
  },
  {
    pattern: /\brespond\b/,
    decl: "declare function respond(status: number, body: unknown): unknown;",
  },
  {
    pattern: /\bsendEmail\s*\(/,
    decl: "declare function sendEmail(to: string, subject: string): Promise<void>;",
  },
  {
    pattern: /\bchargeInvoice\b/,
    decl: "declare function chargeInvoice(invoiceId: string): Promise<void>;",
  },
  {
    pattern: /\bsave\b/,
    decl: "declare function save(data: unknown): Promise<void>;",
  },
  {
    pattern: /\bdeliverWebhook\b/,
    decl: "declare function deliverWebhook(data: unknown): Promise<void>;",
  },
  {
    pattern: /\balertOps\b/,
    decl: "declare function alertOps(message: string, details?: unknown): Promise<void>;",
  },
  {
    pattern: /\bpushToDevice\b/,
    decl: "declare function pushToDevice(userId: string, text: string): Promise<void>;",
  },
  {
    pattern: /\bprovision\b/,
    decl: "declare function provision(userId: string): Promise<void>;",
  },
  {
    pattern: /\bemailClient\b/,
    decl: "declare const emailClient: { send: (userId: string) => Promise<void> };",
  },
  {
    pattern: /\bmockRuntime\b/,
    decl: 'declare const mockRuntime: import("semola/prompts").PromptRuntime;',
  },
  {
    pattern: /\bparseToken\b/,
    decl: "declare function parseToken(token: string): string;",
  },
  {
    pattern: /\bcharge\b/,
    decl: "declare function charge(orderId?: string): Promise<boolean>;",
  },
  {
    pattern: /\bmigrate\b/,
    decl: "declare function migrate(): Promise<void>;",
  },
  {
    pattern: /\brunMigrations\b/,
    decl: "declare function runMigrations(opts: { dryRun: boolean }): Promise<void>;",
  },
  {
    pattern: /\bsender\b/,
    decl: "declare function sender(req: unknown): Promise<void>;",
  },
  {
    pattern: /\bping\b/,
    decl: "declare function ping(): void;",
  },
  {
    pattern: /\bcreateAccount\b/,
    decl: "declare function createAccount(userId: string): Promise<{ id: string }>;",
  },
  {
    pattern: /\bdeleteAccount\b/,
    decl: "declare function deleteAccount(id: string): Promise<void>;",
  },
  {
    pattern: /\bsyncAccount\b/,
    decl: "declare function syncAccount(accountId: string): Promise<void>;",
  },
  {
    pattern: /\bapplyDeployment\b/,
    decl: "declare function applyDeployment(envId: string): Promise<void>;",
  },
  {
    pattern: /\brecordAudit\b/,
    decl: "declare function recordAudit(userId: string): Promise<void>;",
  },
  {
    pattern: /\bpurgeStaleRows\b/,
    decl: "declare function purgeStaleRows(): Promise<void>;",
  },
  {
    pattern: /\bclearTempFiles\b/,
    decl: "declare function clearTempFiles(): Promise<void>;",
  },
  {
    pattern: /\bdeleteOldLogs\b/,
    decl: "declare function deleteOldLogs(): Promise<void>;",
  },
  {
    pattern: /\barchiveInactiveUsers\b/,
    decl: "declare function archiveInactiveUsers(): Promise<void>;",
  },
  {
    pattern: /\bsyncRemote\b/,
    decl: "declare function syncRemote(): Promise<void>;",
  },
  {
    pattern: /\bnotifyTeam\b/,
    decl: "declare function notifyTeam(): Promise<void>;",
  },
  {
    pattern: /\bsendReport\b/,
    decl: "declare function sendReport(): Promise<void>;",
  },
  {
    pattern: /\bMyDomainError\b/,
    decl: "declare class MyDomainError extends Error {}",
  },
  {
    pattern: /\brequest\b/,
    decl: "declare const request: Request;",
  },
  {
    pattern: /\borderId\b/,
    decl: "declare const orderId: string;",
  },
  {
    pattern: /\bdurationMs\b/,
    decl: "declare const durationMs: number;",
  },
  {
    pattern: /\bupstream\b/,
    decl: "declare const upstream: string;",
  },
  {
    pattern: /\bexecutionId\b/,
    decl: "declare const executionId: string;",
    skipWhen: /\{\s*executionId\b/,
  },
];

const isDeclaredInCode = (code: string, name: string) =>
  new RegExp(
    `\\b(const|let|var|function|class|type|interface)\\s+${name}\\b`,
  ).test(code);

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

const augmentBlock = (code: string, blockDir: string) => {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const lines: string[] = ['/// <reference types="bun" />'];
  const { importLines, body } = splitImports(code);
  const importSet = new Set(importLines);

  const requireImport = (line: string) => {
    const match = line.match(/from\s+["']([^"']+)["']/);
    if (match) {
      for (const existing of importSet) {
        if (
          existing.includes(`from "${match[1]}"`) ||
          existing.includes(`from '${match[1]}'`)
        ) {
          return;
        }
      }
    }
    importSet.add(line);
  };

  for (const entry of AUTO_IMPORTS) {
    if (!entry.pattern.test(code)) {
      continue;
    }
    if (entry.skipWhen?.test(code)) {
      continue;
    }
    requireImport(entry.line);
  }

  if (
    /\bexpect\(/.test(code) &&
    !importLines.some((l) => l.includes("bun:test"))
  ) {
    importSet.add('import { expect } from "bun:test";');
  }

  const writeDbStub = () => {
    writeFileSync(join(blockDir, "db.js"), DB_STUB_JS);
    writeFileSync(join(blockDir, "db.d.ts"), DB_STUB_DTS);
  };

  if (/from\s+["']\.\/db\.js["']/.test(code)) {
    writeDbStub();
  }

  const userDecls: string[] = [];
  for (const entry of USER_DECLARATIONS) {
    if (!entry.pattern.test(code)) {
      continue;
    }
    if (entry.skipWhen?.test(code)) {
      continue;
    }
    const nameMatch = entry.decl.match(/(?:function|const|class)\s+(\w+)/);
    const name = nameMatch?.[1];
    if (name && isDeclaredInCode(code, name)) {
      continue;
    }
    userDecls.push(entry.decl);
  }

  let normalized = body.replace(/\{\s*\.\.\.\s*\}/g, "{ return undefined; }");
  const contextLines: string[] = [];

  const declareFromBody: string[] = [];
  const bodyLines: string[] = [];
  for (const line of normalized.split("\n")) {
    if (/^\s*declare\s/.test(line)) {
      declareFromBody.push(line);
      continue;
    }
    bodyLines.push(line);
  }
  normalized = bodyLines.join("\n").trim();

  const hasContextDecl = (needle: string) =>
    declareFromBody.some((line) => line.includes(needle)) ||
    contextLines.some((line) => line.includes(needle));

  const onboardFragment =
    /\bonboard\./.test(normalized) && !/\bdefineWorkflow\b/.test(code);

  if (
    /\bapi\./.test(normalized) &&
    !isDeclaredInCode(code, "api") &&
    !normalized.includes("new Api(")
  ) {
    requireImport('import { Api } from "semola/api";');
    contextLines.push("const api = new Api();");
  }

  if (
    /\bprogram\b/.test(normalized) &&
    !isDeclaredInCode(code, "program") &&
    !normalized.includes("new CLI(")
  ) {
    requireImport('import { CLI } from "semola/cli";');
    contextLines.push(
      'const program = new CLI({ name: "doc", version: "1.0.0" });',
    );
  }

  if (
    /\bmiddlewares:\s*\[auth\]/.test(normalized) &&
    !isDeclaredInCode(code, "auth")
  ) {
    requireImport('import { Middleware } from "semola/api";');
    contextLines.push(`const auth = new Middleware({
  handler: async (c) => ({ userId: "doc-user" }),
});`);
  }

  if (
    (/\bredis\b/.test(normalized) || /\bredis,/.test(normalized)) &&
    !isDeclaredInCode(code, "redis") &&
    !contextLines.some((line) => line.includes("declare const redis"))
  ) {
    contextLines.push("declare const redis: Bun.RedisClient;");
  }

  if (
    /\bcleanup\.(stop|run|next|getStatus)\b/.test(normalized) &&
    !isDeclaredInCode(code, "cleanup")
  ) {
    requireImport('import { Cron } from "semola/cron";');
    contextLines.push(`const cleanup = new Cron({
  name: "cleanup-temp",
  schedule: "@hourly",
  handler: async () => {},
});`);
  }

  if (
    /JSON\.parse\(input\)/.test(normalized) &&
    !isDeclaredInCode(code, "input")
  ) {
    contextLines.push("declare const input: string;");
  }

  if (
    /\btables:\s*\{\s*users\s*\}/.test(normalized) &&
    !isDeclaredInCode(code, "users")
  ) {
    contextLines.push(`const users = defineTable({
  sqlName: "users",
  columns: {
    id: uuid("id").primaryKey().notNull(),
    name: string("name").notNull(),
    email: string("email").notNull().unique(),
  },
});`);
  }

  if (
    /\bheartbeat\./.test(normalized) &&
    !isDeclaredInCode(code, "heartbeat")
  ) {
    requireImport('import { Cron } from "semola/cron";');
    contextLines.push(`const heartbeat = new Cron({
  name: "heartbeat",
  schedule: "* * * * *",
  handler: async () => {},
});`);
  }

  if (/\bbackup\./.test(normalized) && !isDeclaredInCode(code, "backup")) {
    requireImport('import { CronOS } from "semola/cron";');
    contextLines.push(`const backup = new CronOS({
  name: "nightly-backup",
  schedule: "0 0 * * *",
  path: "./scripts/backup.ts",
});`);
  }

  if (/\bdaily\./.test(normalized) && !isDeclaredInCode(code, "daily")) {
    requireImport('import { Cron } from "semola/cron";');
    contextLines.push(`const daily = new Cron({
  name: "daily",
  schedule: "0 9 * * *",
  handler: async () => {},
});`);
  }

  if (
    /\bPolicy</.test(normalized) ||
    (/\bpolicy\.(allow|forbid|can)\b/.test(normalized) &&
      !isDeclaredInCode(code, "policy"))
  ) {
    if (!isDeclaredInCode(code, "User") && /\bUser\b/.test(normalized)) {
      contextLines.push(
        "type User = { id: number; role: string; permissions: string[] };",
      );
    }
  }

  if (
    /\bInferOutput<typeof User>/.test(normalized) &&
    !isDeclaredInCode(code, "User")
  ) {
    requireImport('import { s } from "semola/schema";');
    contextLines.push(
      "const User = s.object({ email: s.email(), id: s.uuid(), age: s.int().min(0) });",
    );
  }

  if (/\bi18n\./.test(normalized) && !isDeclaredInCode(code, "i18n")) {
    requireImport('import { I18n } from "semola/i18n";');
    contextLines.push(`const i18n = new I18n({
  defaultLocale: "en",
  locales: {
    en: {
      greeting: "Hello",
      welcome: "Welcome, {name:string}!",
      messages: {
        unread: "You have {count:number} unread messages",
      },
    },
    es: { greeting: "Hola", welcome: "Bienvenido, {name:string}!" },
  },
});`);
  }

  if (
    (/\bdefineWorkflow\b/.test(code) ||
      /\blistWorkflows\s*\(\s*redisClient/.test(normalized)) &&
    !onboardFragment &&
    !isDeclaredInCode(code, "redisClient") &&
    !hasContextDecl("declare const redisClient")
  ) {
    contextLines.push("declare const redisClient: Bun.RedisClient;");
  }

  if (
    /\bprovision\b/.test(normalized) &&
    !isDeclaredInCode(code, "provision")
  ) {
    contextLines.push(
      "declare function provision(userId: string): Promise<void>;",
    );
  }

  if (
    (/\bnew Cache\b/.test(normalized) ||
      (/\busers\.(get|set|delete)\b/.test(normalized) &&
        !isDeclaredInCode(code, "users"))) &&
    !isDeclaredInCode(code, "users") &&
    /\busers\./.test(normalized) &&
    !hasContextDecl("const users = new Cache")
  ) {
    requireImport('import { Cache } from "semola/cache";');
    if (!hasContextDecl("declare const redisClient")) {
      contextLines.push("declare const redisClient: Bun.RedisClient;");
    }
    contextLines.push(`const users = new Cache<{ name: string; email: string }>({
  redis: redisClient,
});`);
  }

  if (
    /\bposts\.(allow|forbid|can)\b/.test(normalized) &&
    !isDeclaredInCode(code, "posts")
  ) {
    requireImport('import { Policy } from "semola/policy";');
    contextLines.push(`type Post = {
  id: number;
  authorId: number;
  status: "draft" | "published";
  tags: string[];
  permissions?: string[];
};
const posts = new Policy<Post>();`);
  }

  if (
    (/\bevents\./.test(normalized) ||
      (/\bfor await\b/.test(normalized) && /\bevents\b/.test(normalized))) &&
    !isDeclaredInCode(code, "events") &&
    !/new PubSub/.test(normalized)
  ) {
    requireImport('import { PubSub } from "semola/pubsub";');
    contextLines.push(`declare const redisSubscriber: Bun.RedisClient;
declare const redisPublisher: Bun.RedisClient;
type PubMessage = { userId: string; action: string; text?: string };
const events = new PubSub<PubMessage>({
  subscriber: redisSubscriber,
  publisher: redisPublisher,
  channel: "events",
});`);
  }

  if (
    /\bhandler\b/.test(normalized) &&
    (/\bevents\.(on|off)\b/.test(normalized) ||
      /\bevents\.subscribe\(handler\)/.test(normalized))
  ) {
    if (!isDeclaredInCode(code, "handler")) {
      contextLines.push(
        "declare const handler: (message: { userId: string; action: string }) => void;",
      );
    }
  }

  if (/\bQueue<EmailJob>/.test(code) && !isDeclaredInCode(code, "EmailJob")) {
    contextLines.push("type EmailJob = { to: string; subject: string };");
  }

  if (/\bemails\./.test(normalized) && !isDeclaredInCode(code, "emails")) {
    requireImport('import { Queue } from "semola/queue";');
    contextLines.push(`declare const redisClient: Bun.RedisClient;
type EmailJob = { to: string; subject: string };
const emails = new Queue<EmailJob>({
  name: "emails",
  redis: redisClient,
  handler: async () => {},
});`);
  }

  if (
    /new Queue/.test(normalized) &&
    /chargeInvoice\(data\.invoiceId\)/.test(normalized) &&
    !/Queue<\{/.test(normalized)
  ) {
    contextLines.push("type InvoiceJob = { invoiceId: string };");
    normalized = normalized.replace(/new Queue\(\{/, "new Queue<InvoiceJob>({");
  }

  if (
    (/\bredisClient\b/.test(normalized) ||
      /\bredis:\s*redisClient\b/.test(normalized)) &&
    !onboardFragment &&
    !isDeclaredInCode(code, "redisClient") &&
    !hasContextDecl("declare const redisClient")
  ) {
    contextLines.push("declare const redisClient: Bun.RedisClient;");
  }

  if (
    (/\bredisSubscriber\b/.test(normalized) ||
      /\bredisPublisher\b/.test(normalized)) &&
    !isDeclaredInCode(code, "redisSubscriber") &&
    !hasContextDecl("declare const redisSubscriber")
  ) {
    contextLines.push(`declare const redisSubscriber: Bun.RedisClient;
declare const redisPublisher: Bun.RedisClient;`);
  }

  if (
    /\bevents\.off\(handler\)/.test(normalized) &&
    !isDeclaredInCode(code, "handler")
  ) {
    contextLines.push(
      "declare const handler: (message: { userId: string; action: string }) => void;",
    );
  }

  if (
    /\bdb\./.test(normalized) &&
    !isDeclaredInCode(code, "db") &&
    !/from\s+["']\.\/db\.js["']/.test(code)
  ) {
    writeDbStub();
    importSet.add('import { db } from "./db.js";');
  }

  if (/\bmeter\./.test(normalized) && !isDeclaredInCode(code, "meter")) {
    requireImport('import { Otel } from "semola/otel";');
    if (!isDeclaredInCode(code, "otel")) {
      contextLines.push(`const otel = new Otel({
  serviceName: "doc",
  enabled: false,
  export: { type: "otlp-http", url: "http://localhost:4318" },
});`);
    }
    contextLines.push('const meter = otel.meter("doc");');
  }

  if (
    (/\botel\./.test(normalized) || /\btracer\./.test(normalized)) &&
    !isDeclaredInCode(code, "otel")
  ) {
    requireImport('import { Otel } from "semola/otel";');
    contextLines.push(`const otel = new Otel({
  serviceName: "doc",
  enabled: false,
  export: { type: "otlp-http", url: "http://localhost:4318" },
});`);
  }

  if (/\btracer\./.test(normalized) && !isDeclaredInCode(code, "tracer")) {
    contextLines.push('const tracer = otel.tracer("doc");');
  }

  if (
    /\bUser\[["']~standard["']\]/.test(normalized) &&
    !isDeclaredInCode(code, "User")
  ) {
    requireImport('import { s, type InferOutput } from "semola/schema";');
    contextLines.push(`const User = s.object({
  email: s.email(),
  id: s.uuid(),
  age: s.int().min(0),
});
declare const user: InferOutput<typeof User>;`);
  }

  if (onboardFragment && !isDeclaredInCode(code, "onboard")) {
    requireImport('import { defineWorkflow } from "semola/workflow";');
    contextLines.push(`declare const redisClient: Bun.RedisClient;
declare const emailClient: { send: (userId: string) => Promise<void> };
declare function provision(userId: string): Promise<void>;
const onboard = defineWorkflow<{ userId: string }, { ok: true }>({
  name: "onboard-user-doc",
  redis: redisClient,
  handler: async ({ input, step, sleep }) => {
    await step("send-email", async () => {
      await emailClient.send(input.userId);
    });
    await sleep(1000);
    await step("provision", async () => {
      await provision(input.userId);
    });
    return { ok: true };
  },
});`);
  }

  if (/\bgetUser\(id\)/.test(normalized) && !isDeclaredInCode(code, "id")) {
    contextLines.push("declare const id: string;");
  }

  if (declareFromBody.length > 0) {
    contextLines.unshift(...declareFromBody);
  }

  if (importSet.size > 0) {
    lines.push([...importSet].join("\n"));
  }

  if (userDecls.length > 0) {
    lines.push(userDecls.join("\n"));
  }

  if (contextLines.length > 0) {
    lines.push(contextLines.join("\n"));
  }

  const hasAwait = /\bawait\b/.test(normalized);
  const hasTopLevelReturn = /(?:^|\n)\s*return\b/.test(normalized);

  if (hasAwait) {
    normalized = `await (async () => {\n${normalized}\n})();`;
  } else if (hasTopLevelReturn) {
    normalized = `(() => {\n${normalized}\n})();`;
  }

  lines.push(normalized);
  lines.push("export {};");
  return lines.join("\n\n");
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
): { mode: BlockMode; skipReason?: string } => {
  if (!FENCE_LANGS.has(lang as FenceLang)) {
    return { mode: "skip", skipReason: "non-typescript fence" };
  }

  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return { mode: "skip", skipReason: "empty" };
  }

  if (isTypeSignatureBlock(trimmed)) {
    return { mode: "skip", skipReason: "type signature only" };
  }

  const { body: importBody } = splitImports(trimmed);
  if (importBody.length === 0 && /^\s*import\s/m.test(trimmed)) {
    return { mode: "skip", skipReason: "import-only" };
  }

  return { mode: "typecheck" };
};

const forbiddenInDocs = (code: string): string | null => {
  if (/\bapi\.listen\b/.test(code)) {
    return "api.listen (use api.serve)";
  }
  if (/\bctx\.params\b/.test(code)) {
    return "ctx.params (use c.req.params)";
  }
  if (/\bc\.params\b/.test(code)) {
    return "c.params (use c.req.params)";
  }
  if (/createRetry\s*\(\s*(\n\s*)?async/.test(code)) {
    return "createRetry(async fn, opts) (use single options object with input)";
  }
  return null;
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
      blocks.push({ file, line: startLine, lang, code: buffer.join("\n") });
      inFence = false;
      buffer = [];
      continue;
    }
    buffer.push(line);
  }

  return blocks;
};

const slugifyHeading = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");

const extractHeadings = (content: string) => {
  const headings: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push(slugifyHeading(match[2]));
    }
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
      headingCache.set(path, extractHeadings(readFileSync(path, "utf8")));
    }
    return headingCache.get(path) ?? [];
  };

  const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
  for (const file of MARKDOWN_FILES) {
    const content = readFileSync(file, "utf8");
    const dir = dirname(file);
    for (const match of content.matchAll(linkPattern)) {
      const raw = match[2];
      if (!raw || raw.startsWith("http://") || raw.startsWith("https://")) {
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
        const anchorSlug = slugifyHeading(anchor);
        if (!getHeadings(targetPath).includes(anchorSlug)) {
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

const RUN_ALLOW_PATTERNS: RegExp[] = [
  /\.parse\(/,
  /\.safeParse\(/,
  /\bpolicy\.can\(/,
  /\bcreateRetry\s*\(/,
  /\bnew Logger\s*\(/,
  /\bapi\.fetch\s*\(/,
  /\bcronJobBuilder\b/,
  /\bmightThrow(Sync)?\b/,
  /\bnew I18n\s*\(/,
  /\bi18n\.t\s*\(/,
  /\bnew ConsoleProvider\s*\(/,
  /\bobject\s*\(/,
  /\bs\.object\s*\(/,
];

const shouldRunBlock = (code: string) => {
  if (!RUN_ALLOW_PATTERNS.some((pattern) => pattern.test(code))) {
    return false;
  }
  return !RUN_SKIP_PATTERNS.some((pattern) => pattern.test(code));
};

const tryRunBlock = (filePath: string, cwd: string) =>
  spawnSync("bun", [filePath], { cwd, encoding: "utf8", timeout: 8000 });

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
    cwd: string;
  }> = [];
  let blockIndex = 0;

  for (const block of allBlocks) {
    const id = `${basename(block.file)}:${block.line}`;
    const { mode, skipReason } = classifyBlock(block.code, block.lang);

    if (mode === "skip") {
      results.push({
        id,
        file: block.file,
        line: block.line,
        mode: "skip",
        ok: true,
        skipReason,
      });
      continue;
    }

    const forbidden = forbiddenInDocs(block.code);
    if (forbidden) {
      results.push({
        id,
        file: block.file,
        line: block.line,
        mode: "typecheck",
        ok: false,
        detail: forbidden,
      });
      continue;
    }

    const blockDir = join(CACHE_DIR, `block-${blockIndex}`);
    mkdirSync(blockDir, { recursive: true });
    const outFile = join(blockDir, "main.ts");
    writeFileSync(outFile, augmentBlock(block.code, blockDir));
    typecheckEntries.push({ block, file: outFile, cwd: blockDir });
    blockIndex += 1;

    results.push({
      id,
      file: block.file,
      line: block.line,
      mode: "typecheck",
      ok: true,
    });
  }

  const tsc = spawnSync(
    "bunx",
    ["tsc", "-p", join(ROOT, "tsconfig.docs-check.json")],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );

  if (tsc.status !== 0) {
    const errorText = `${tsc.stdout}\n${tsc.stderr}`;
    console.error(errorText);
    for (const match of errorText.matchAll(/block-(\d+)\/main\.ts/g)) {
      const index = Number(match[1]);
      const entry = typecheckEntries[index];
      if (!entry) {
        continue;
      }
      const tcResult = results.find(
        (r) => r.id === `${basename(entry.block.file)}:${entry.block.line}`,
      );
      if (tcResult) {
        tcResult.ok = false;
        tcResult.detail = "tsc error";
      }
    }
  }

  let runCount = 0;
  for (const entry of typecheckEntries) {
    const id = `${basename(entry.block.file)}:${entry.block.line}`;
    const tcResult = results.find((r) => r.id === id);
    if (!tcResult || !tcResult.ok) {
      continue;
    }
    if (!shouldRunBlock(entry.block.code)) {
      continue;
    }

    const runResult = tryRunBlock(entry.file, entry.cwd);
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
  const skipped = results.filter((r) => r.mode === "skip");

  console.log("Docs example check summary");
  console.log(`  markdown files: ${MARKDOWN_FILES.length}`);
  console.log(`  fenced blocks total: ${allBlocks.length}`);
  console.log(`  type-checked: ${typecheckEntries.length}`);
  console.log(`  run: ${runCount}`);
  console.log(`  skipped: ${skipped.length}`);
  for (const reason of [
    "non-typescript fence",
    "empty",
    "type signature only",
    "import-only",
  ]) {
    const count = skipped.filter((r) => r.skipReason === reason).length;
    if (count > 0) {
      console.log(`    - ${reason}: ${count}`);
    }
  }
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

  if (linkIssues.length > 0 || failures.length > 0) {
    process.exit(1);
  }
};

main();
