import { CodeSnippet } from "@/components/code-snippet";
import { HomeShowcase } from "@/components/home-showcase";
import { InstallCommand } from "@/components/install-command";
import Link from "next/link";

const packages = [
  {
    group: "HTTP & Jobs",
    items: [
      { name: "API", href: "/docs/api", blurb: "Typed REST + OpenAPI" },
      { name: "Queue", href: "/docs/queue", blurb: "Redis jobs + retries" },
      { name: "PubSub", href: "/docs/pubsub", blurb: "Realtime messaging" },
      { name: "Cron", href: "/docs/cron", blurb: "Schedulers that run" },
      { name: "Workflow", href: "/docs/workflow", blurb: "Durable steps" },
    ],
  },
  {
    group: "Data & Auth",
    items: [
      { name: "ORM", href: "/docs/orm", blurb: "Typed SQL layer" },
      { name: "Cache", href: "/docs/cache", blurb: "Redis + TTL" },
      { name: "Policy", href: "/docs/policy", blurb: "Authz guards" },
      { name: "i18n", href: "/docs/i18n", blurb: "Compile-time keys" },
    ],
  },
  {
    group: "Utilities",
    items: [
      { name: "Errors", href: "/docs/errors", blurb: "Result tuples" },
      { name: "Logging", href: "/docs/logging", blurb: "Simple logger" },
      { name: "Prompts", href: "/docs/prompts", blurb: "Interactive CLI" },
      { name: "CLI", href: "/docs/cli", blurb: "Argv + schemas" },
      { name: "Extra", href: "/docs/extra", blurb: "Tiny helpers" },
    ],
  },
];

const errorsExample = `import { mightThrow } from "semola/errors";

const [error, data] = await mightThrow(
  fetch("https://api.example.com"),
);

if (error) {
  console.error(error.message);
  return;
}

// data is narrowed - no try/catch nesting
console.log(data);`;

const schemaExample = `import { Api } from "semola/api";
import { z } from "zod";
// or: import * as v from "valibot";

const api = new Api();

api.defineRoute({
  path: "/users/:id",
  method: "GET",
  request: {
    params: z.object({ id: z.string() }),
  },
  response: {
    200: z.object({ id: z.string(), email: z.string() }),
  },
  handler: async (c) => {
    return c.json(200, await getUser(c.req.params.id));
  },
});`;

const queueExample = `import { Queue } from "semola/queue";

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
});`;

const policyExample = `import { Policy, eq } from "semola/policy";

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

const canEdit = posts.can("update", post);`;

const workflowExample = `import { defineWorkflow } from "semola/workflow";

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

await fulfillOrder.start({ orderId: "ord_123" });`;

const ormExample = `import {
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
});`;

const footerLinks = [
  {
    title: "Documentation",
    links: [
      { label: "Getting Started", href: "/docs/getting-started" },
      { label: "API", href: "/docs/api" },
      { label: "Queue", href: "/docs/queue" },
      { label: "ORM", href: "/docs/orm" },
      { label: "Errors", href: "/docs/errors" },
    ],
  },
  {
    title: "Package",
    links: [
      { label: "npm", href: "https://www.npmjs.com/package/semola" },
      {
        label: "GitHub",
        href: "https://github.com/leonardodipace/semola",
      },
      {
        label: "Releases",
        href: "https://github.com/leonardodipace/semola/releases",
      },
    ],
  },
];

export default function HomePage() {
  return (
    <div className="relative flex flex-1 flex-col">
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="home-glow pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,var(--color-wheat-dim),transparent_70%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklab,var(--color-fd-foreground)_6%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--color-fd-foreground)_6%,transparent)_1px,transparent_1px)] bg-size-[48px_48px] mask-[radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
        />

        <div className="relative mx-auto grid w-full max-w-6xl items-start gap-12 px-6 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:py-24">
          <div className="text-center lg:text-left">
            <p className="home-fade-up mb-4 text-sm font-medium tracking-wide text-wheat">
              Zero-dependency TypeScript utilities
            </p>
            <h1 className="home-fade-up-delay-1 mb-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Type-safe building blocks for real backends.
            </h1>
            <p className="home-fade-up-delay-2 mx-auto mb-8 max-w-xl text-lg text-fd-muted-foreground lg:mx-0">
              APIs, queues, workflows, ORM, auth, and more - import only what
              you use. No runtime dependency tree to babysit.
            </p>
            <div className="home-fade-up-delay-3 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
              <InstallCommand />
              <Link
                href="/docs"
                className="text-sm font-medium text-wheat hover:underline"
              >
                Documentation →
              </Link>
            </div>
          </div>

          <HomeShowcase />
        </div>
      </section>

      <section className="border-t border-fd-border bg-fd-background">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mb-10 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">
                Modules you can pick up one at a time
              </h2>
              <p className="mt-2 max-w-2xl text-fd-muted-foreground">
                Start with errors or an API route, then add queues, data, and
                auth when the app needs them.
              </p>
            </div>
            <Link
              href="/docs"
              className="shrink-0 text-sm font-medium text-wheat hover:underline"
            >
              Full documentation →
            </Link>
          </div>

          <div className="grid gap-10 md:grid-cols-3">
            {packages.map((group) => (
              <div key={group.group}>
                <h3 className="mb-4 text-xs font-semibold tracking-wider text-fd-muted-foreground uppercase">
                  {group.group}
                </h3>
                <ul className="space-y-1">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="group flex items-baseline justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-fd-accent"
                      >
                        <span className="font-medium group-hover:text-wheat">
                          {item.name}
                        </span>
                        <span className="truncate text-sm text-fd-muted-foreground">
                          {item.blurb}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-fd-border bg-fd-secondary/30">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-2 lg:items-start">
          <div>
            <p className="mb-2 font-mono text-xs tracking-wider text-wheat uppercase">
              semola/errors
            </p>
            <h2 className="text-3xl font-semibold tracking-tight">
              Errors as values, not control flow
            </h2>
            <p className="mt-3 text-fd-muted-foreground">
              <code className="text-fd-foreground">mightThrow</code> turns
              promises into{" "}
              <code className="text-fd-foreground">[error, data]</code> tuples.
              Branch on the error, then use narrowed success data - no nested
              try/catch.
            </p>
            <Link
              href="/docs/errors"
              className="mt-5 inline-block text-sm font-medium text-wheat hover:underline"
            >
              Errors docs →
            </Link>
          </div>
          <CodeSnippet code={errorsExample} title="fetch.ts" />
        </div>
      </section>

      <section className="border-t border-fd-border bg-fd-background">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-2 lg:items-start">
          <div className="lg:order-2">
            <p className="mb-2 font-mono text-xs tracking-wider text-wheat uppercase">
              Standard Schema
            </p>
            <h2 className="text-3xl font-semibold tracking-tight">
              Bring your own validator
            </h2>
            <p className="mt-3 text-fd-muted-foreground">
              Routes and inputs accept any Standard Schema library - Zod,
              Valibot, ArkType, and others. Semola does not lock you into one
              schema stack.
            </p>
            <Link
              href="/docs/api"
              className="mt-5 inline-block text-sm font-medium text-wheat hover:underline"
            >
              API docs →
            </Link>
          </div>
          <div className="lg:order-1">
            <CodeSnippet code={schemaExample} title="users.ts" />
          </div>
        </div>
      </section>

      <section className="border-t border-fd-border bg-fd-secondary/30">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-2 lg:items-start">
          <div>
            <p className="mb-2 font-mono text-xs tracking-wider text-wheat uppercase">
              semola/queue
            </p>
            <h2 className="text-3xl font-semibold tracking-tight">
              Background jobs with retries built in
            </h2>
            <p className="mt-3 text-fd-muted-foreground">
              Redis-backed queues with concurrency, timeouts, and exponential
              backoff. Enqueue work, handle failures without reinventing the
              worker loop.
            </p>
            <Link
              href="/docs/queue"
              className="mt-5 inline-block text-sm font-medium text-wheat hover:underline"
            >
              Queue docs →
            </Link>
          </div>
          <CodeSnippet code={queueExample} title="jobs.ts" />
        </div>
      </section>

      <section className="border-t border-fd-border bg-fd-background">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-2 lg:items-start">
          <div className="lg:order-2">
            <p className="mb-2 font-mono text-xs tracking-wider text-wheat uppercase">
              semola/policy
            </p>
            <h2 className="text-3xl font-semibold tracking-tight">
              Authorization as typed rules
            </h2>
            <p className="mt-3 text-fd-muted-foreground">
              Declare allow/deny rules against your domain types. Conditions
              stay type-checked - no stringly-permission matrices.
            </p>
            <Link
              href="/docs/policy"
              className="mt-5 inline-block text-sm font-medium text-wheat hover:underline"
            >
              Policy docs →
            </Link>
          </div>
          <div className="lg:order-1">
            <CodeSnippet code={policyExample} title="posts.ts" />
          </div>
        </div>
      </section>

      <section className="border-t border-fd-border bg-fd-secondary/30">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-2 lg:items-start">
          <div>
            <p className="mb-2 font-mono text-xs tracking-wider text-wheat uppercase">
              semola/workflow
            </p>
            <h2 className="text-3xl font-semibold tracking-tight">
              Durable steps that survive crashes
            </h2>
            <p className="mt-3 text-fd-muted-foreground">
              Named steps persist outputs. Resume after a process death and skip
              work that already completed.
            </p>
            <Link
              href="/docs/workflow"
              className="mt-5 inline-block text-sm font-medium text-wheat hover:underline"
            >
              Workflow docs →
            </Link>
          </div>
          <CodeSnippet code={workflowExample} title="order.ts" />
        </div>
      </section>

      <section className="border-t border-fd-border bg-fd-background">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-2 lg:items-start">
          <div className="lg:order-2">
            <p className="mb-2 font-mono text-xs tracking-wider text-wheat uppercase">
              semola/orm
            </p>
            <h2 className="text-3xl font-semibold tracking-tight">
              Typed tables, typed queries
            </h2>
            <p className="mt-3 text-fd-muted-foreground">
              Define columns once.{" "}
              <code className="text-fd-foreground">findFirst</code>, inserts,
              and relations infer from the table definition.
            </p>
            <Link
              href="/docs/orm"
              className="mt-5 inline-block text-sm font-medium text-wheat hover:underline"
            >
              ORM docs →
            </Link>
          </div>
          <div className="lg:order-1">
            <CodeSnippet code={ormExample} title="users.ts" />
          </div>
        </div>
      </section>

      <footer className="border-t border-fd-border bg-fd-secondary/40">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <Link href="/" className="inline-flex items-center gap-2 font-medium">
                <img
                  src="/logo.png"
                  alt=""
                  width={28}
                  height={28}
                  className="size-7 rounded-md"
                />
                Semola
              </Link>
              <p className="mt-3 max-w-sm text-sm text-fd-muted-foreground">
                Zero-dependency TypeScript utilities for type-safe backends.
              </p>
              <div className="mt-5">
                <InstallCommand />
              </div>
            </div>

            {footerLinks.map((group) => (
              <div key={group.title}>
                <h3 className="mb-3 text-sm font-semibold">{group.title}</h3>
                <ul className="space-y-2 text-sm text-fd-muted-foreground">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      {link.href.startsWith("http") ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-fd-foreground"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="hover:text-fd-foreground"
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-col gap-2 border-t border-fd-border pt-6 text-xs text-fd-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>MIT License</p>
            <p>
              <a
                href="https://github.com/leonardodipace/semola"
                target="_blank"
                rel="noreferrer"
                className="hover:text-fd-foreground"
              >
                leonardodipace/semola
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
