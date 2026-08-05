export const homeModules = [
  {
    id: "api",
    label: "API",
    pkg: "semola/api",
    href: "/docs/api",
    blurb: "Typed REST routes + OpenAPI",
    title: "Typed routes, any schema",
    body: "Define REST handlers with request and response schemas. Works with Zod, Valibot, ArkType, or any Standard Schema library.",
    file: "hello.ts",
    code: `import { Api } from "semola/api";
import { z } from "zod";

const api = new Api();

api.defineRoute({
  path: "/hello/:name",
  method: "GET",
  request: {
    params: z.object({ name: z.string() }),
  },
  response: {
    200: z.object({ message: z.string() }),
  },
  handler: async (c) => {
    return c.json(200, {
      message: \`Hello, \${c.req.params.name}!\`,
    });
  },
});

api.serve(3000);`,
  },
  {
    id: "cache",
    label: "Cache",
    pkg: "semola/cache",
    href: "/docs/cache",
    blurb: "Redis cache with TTL",
    title: "Typed cache with TTL",
    body: "Store and load JSON values in Redis. Optional prefix and per-key expiry without hand-rolling serialization.",
    file: "users.ts",
    code: `import { Cache } from "semola/cache";

const users = new Cache<{ name: string; email: string }>({
  redis: redisClient,
  ttl: 60_000,
  prefix: "user",
});

await users.set("1", {
  name: "Ada",
  email: "ada@example.com",
});

const user = await users.get("1");`,
  },
  {
    id: "cli",
    label: "CLI",
    pkg: "semola/cli",
    href: "/docs/cli",
    blurb: "Argv parsing with schemas",
    title: "Typed command-line programs",
    body: "Nested commands, validated arguments, and options with Standard Schema. Parse argv or pass arrays in tests.",
    file: "program.ts",
    code: `import { CLI } from "semola/cli";
import { z } from "zod";

const program = new CLI({
  name: "semola",
  version: "1.0.0",
});

program
  .command("split")
  .argument("str", { schema: z.string() })
  .option("first", {
    schema: z.boolean().default(false),
    aliases: ["f"],
  })
  .action((args, options) => {
    const parts = args.str.split(" ");
    console.log(options.first ? parts[0] : parts);
  });

await program.parse();`,
  },
  {
    id: "cron",
    label: "Cron",
    pkg: "semola/cron",
    href: "/docs/cron",
    blurb: "Schedulers that actually run",
    title: "Schedules in-process",
    body: "Run handlers on a cron expression or alias. Start, stop, and ask for the next fire time from one object.",
    file: "jobs.ts",
    code: `import { Cron } from "semola/cron";

const daily = new Cron({
  name: "daily-report",
  schedule: "@daily",
  handler: async () => {
    await sendReport();
  },
});

daily.run();`,
  },
  {
    id: "errors",
    label: "Errors",
    pkg: "semola/errors",
    href: "/docs/errors",
    blurb: "Result tuples, no nested try/catch",
    title: "Errors as values",
    body: "mightThrow turns promises into [error, data] tuples. Branch once, then use narrowed success data - no nested try/catch.",
    file: "fetch.ts",
    code: `import { mightThrow } from "semola/errors";

const [error, data] = await mightThrow(
  fetch("https://api.example.com"),
);

if (error) {
  console.error(error.message);
  return;
}

console.log(data);`,
  },
  {
    id: "extra",
    label: "Extra",
    pkg: "semola/extra",
    href: "/docs/extra",
    blurb: "Tiny helpers",
    title: "Small helpers, big saves",
    body: "Odds and ends that are useful but too small for their own package - like retries with full-jitter backoff.",
    file: "retry.ts",
    code: `import { createRetry } from "semola/extra";

const fetchUser = createRetry(
  async (id: string) => {
    const res = await fetch(\`/users/\${id}\`);

    if (!res.ok) {
      throw new Error(\`HTTP \${res.status}\`);
    }

    return res.json();
  },
  { maxRetries: 3 },
);

const user = await fetchUser("123");`,
  },
  {
    id: "i18n",
    label: "i18n",
    pkg: "semola/i18n",
    href: "/docs/i18n",
    blurb: "Compile-time translation keys",
    title: "Typed translations",
    body: "Locale dictionaries with nested keys and typed placeholders. Switch language and interpolate without stringly APIs.",
    file: "messages.ts",
    code: `import { I18n } from "semola/i18n";

const i18n = new I18n({
  defaultLocale: "en",
  locales: {
    en: {
      welcome: "Welcome, {name:string}!",
    },
    es: {
      welcome: "Bienvenido, {name:string}!",
    },
  },
});

i18n.setLocale("es");
i18n.translate("welcome", { name: "Ada" });`,
  },
  {
    id: "logging",
    label: "Logging",
    pkg: "semola/logging",
    href: "/docs/logging",
    blurb: "Simple structured logger",
    title: "Prefixed loggers",
    body: "One logger, console and file providers, optional formatters. Enough structure without a logging framework.",
    file: "log.ts",
    code: `import { Logger, ConsoleProvider } from "semola/logging";

const log = new Logger("api", [new ConsoleProvider()]);

log.info("server started");
log.warning("slow query");
log.error("request failed");`,
  },
  {
    id: "orm",
    label: "ORM",
    pkg: "semola/orm",
    href: "/docs/orm",
    blurb: "Typed tables and queries",
    title: "Typed tables and queries",
    body: "Define columns once. findFirst, inserts, and relations infer from the table definition.",
    file: "users.ts",
    code: `import {
  createOrm,
  defineTable,
  string,
  uuid,
} from "semola/orm";

const users = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  email: string("email").unique().notNull(),
});

const db = createOrm({
  adapter: "sqlite",
  url: ":memory:",
  tables: { users },
});

const user = await db.users.findFirst({
  where: { email: "hi@semola.dev" },
});`,
  },
  {
    id: "policy",
    label: "Policy",
    pkg: "semola/policy",
    href: "/docs/policy",
    blurb: "Authorization as typed rules",
    title: "Authorization as rules",
    body: "Allow and forbid actions with composable conditions over your domain types. Forbid always wins.",
    file: "posts.ts",
    code: `import { Policy, eq } from "semola/policy";

type Post = {
  id: number;
  authorId: number;
  status: "draft" | "published";
};

const posts = new Policy<Post>();

posts.allow({
  action: "read",
  conditions: { status: eq("published") },
});

posts.allow({
  action: ["update", "delete"],
  conditions: { authorId: eq(user.id) },
});

const canEdit = posts.can("update", post);`,
  },
  {
    id: "prompts",
    label: "Prompts",
    pkg: "semola/prompts",
    href: "/docs/prompts",
    blurb: "Interactive CLI prompts",
    title: "Terminal prompts",
    body: "Ask for text, passwords, confirms, numbers, and selects. Built for real TTYs, mockable in tests.",
    file: "setup.ts",
    code: `import { input, confirm, select } from "semola/prompts";

const name = await input({
  message: "Project name",
  required: true,
});

const proceed = await confirm({
  message: "Create the project?",
  defaultValue: true,
});

const runtime = await select({
  message: "Runtime",
  options: [
    { value: "bun", label: "Bun" },
    { value: "node", label: "Node" },
  ],
});`,
  },
  {
    id: "pubsub",
    label: "PubSub",
    pkg: "semola/pubsub",
    href: "/docs/pubsub",
    blurb: "Realtime messaging",
    title: "Typed pub/sub",
    body: "Publish and subscribe to JSON messages on a Redis channel. Publisher and subscriber clients stay explicit.",
    file: "events.ts",
    code: `import { PubSub } from "semola/pubsub";

type UserEvent = {
  userId: string;
  action: "login" | "logout";
};

const events = new PubSub<UserEvent>({
  subscriber: redisSubscriber,
  publisher: redisPublisher,
  channel: "user-events",
});

await events.subscribe(async (message) => {
  console.log(message.userId, message.action);
});

await events.publish({
  userId: "123",
  action: "login",
});`,
  },
  {
    id: "queue",
    label: "Queue",
    pkg: "semola/queue",
    href: "/docs/queue",
    blurb: "Redis jobs, retries, concurrency",
    title: "Jobs with retries built in",
    body: "Redis-backed queues with concurrency, timeouts, and exponential backoff. Enqueue work without reinventing the worker loop.",
    file: "jobs.ts",
    code: `import { Queue } from "semola/queue";

const emails = new Queue({
  name: "emails",
  redis: redisClient,
  concurrency: 4,
  retries: 3,
  handler: async (data) => {
    await sendEmail(data.to, data.subject);
  },
});

await emails.enqueue({
  to: "user@example.com",
  subject: "Welcome",
});`,
  },
  {
    id: "workflow",
    label: "Workflow",
    pkg: "semola/workflow",
    href: "/docs/workflow",
    blurb: "Durable steps that survive crashes",
    title: "Durable steps",
    body: "Named steps persist outputs. Resume after a process death and skip work that already completed.",
    file: "order.ts",
    code: `import { defineWorkflow } from "semola/workflow";

const fulfillOrder = defineWorkflow<{ orderId: string }>({
  name: "fulfill-order",
  redis: redisClient,
  handler: async ({ input, step }) => {
    const payment = await step("charge", async () => {
      return charge(input.orderId);
    });

    await step("ship", async () => {
      await ship(payment.orderId);
    });
  },
});

await fulfillOrder.start({ orderId: "ord_123" });`,
  },
] as const;

const featuredIds = [
  "api",
  "cron",
  "orm",
  "policy",
  "queue",
  "workflow",
] as const;

const showcaseIds = [
  "api",
  "cache",
  "cron",
  "errors",
  "i18n",
  "logging",
  "orm",
  "policy",
  "pubsub",
  "queue",
  "workflow",
] as const;

export const featuredHomeModules = homeModules.filter((module) =>
  (featuredIds as readonly string[]).includes(module.id),
);

export const showcaseHomeModules = homeModules.filter((module) =>
  (showcaseIds as readonly string[]).includes(module.id),
);
