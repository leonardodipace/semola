export type CodeHover = {
  token: string;
  within?: string;
  nth?: number;
  type?: string;
  doc?: string;
  error?: string;
  errorCode?: number;
};

export type CodeSample = {
  code: string;
  hovers: CodeHover[];
};

export const findHoverStart = (code: string, hover: CodeHover) => {
  const context = hover.within ?? hover.token;
  let index = -1;

  for (let count = 0; count < (hover.nth ?? 1); count++) {
    index = code.indexOf(context, index + 1);

    if (index === -1) {
      throw new Error(`Hover context "${context}" is missing from the sample`);
    }
  }

  return index + context.indexOf(hover.token);
};

export const describeError = (sample: CodeSample, file: string) => {
  const errorHover = sample.hovers.find((hover) => hover.error);

  if (!errorHover) throw new Error(`${file} has no error hover`);

  const lines = sample.code
    .slice(0, findHoverStart(sample.code, errorHover))
    .split("\n");
  const column = (lines.at(-1)?.length ?? 0) + 1;

  return {
    message: errorHover.error ?? "",
    location: `${file}  Ln ${lines.length}, Col ${column}  ts(${errorHover.errorCode})`,
  };
};

export type ModuleExample = {
  pkg: string;
  label: string;
  href: string;
  title: string;
  body: string;
  file: string;
  breakLabel: string;
  sample: CodeSample;
  broken: CodeSample;
};

const signupRoute = (response: string) => `import { Api } from "semola/api";
import { Queue } from "semola/queue";
import { boolean, email, object } from "semola/schema";

const emails = new Queue<{ to: string }>({
  name: "emails",
  redis: redisClient,
  handler: async (job) => sendWelcomeEmail(job.to),
});

export const api = new Api();

export const signup = api.defineRoute({
  path: "/signup",
  method: "POST",
  request: { body: object({ email: email() }) },
  response: { 201: object({ queued: boolean() }) },
  handler: async (c) => {
    await emails.enqueue({ to: c.req.body.email });
    return c.json(201, { ${response}: true });
  },
});

api.serve(3000);`;

const heroHovers: CodeHover[] = [
  { token: "emails", type: "const emails: Queue<{ to: string }>" },
  { token: "job", type: "(parameter) job: { to: string }" },
  {
    token: "Api",
    within: "new Api()",
    type: "(alias) new Api<readonly [], undefined>(options?: ApiOptions<readonly [], undefined>): Api<readonly [], undefined>\nimport Api",
  },
  {
    token: "email",
    within: "email()",
    type: "(alias) email(message?: string): StringSchema\nimport email",
  },
  {
    token: "enqueue",
    type: "(method) Queue<{ to: string }>.enqueue(data: { to: string }): Promise<string>",
  },
  {
    token: "email",
    within: "body.email",
    type: "(property) email: string",
    doc: "Validated against the request schema before the handler runs.",
  },
  {
    token: "serve",
    type: "(method) Api<readonly [], undefined>.serve(port: number, callback?: (server: Bun.Server<unknown>) => void): void",
  },
];

export const heroSample: CodeSample = {
  code: signupRoute("queued"),
  hovers: [
    ...heroHovers,
    {
      token: "json",
      within: "c.json",
      type: "(property) json: <201, { readonly queued: true }>(status: 201, data: { readonly queued: boolean }) => Response",
    },
    {
      token: "queued",
      within: "{ queued: true }",
      type: "(property) queued: boolean",
    },
  ],
};

export const heroBrokenSample: CodeSample = {
  code: signupRoute("queud"),
  hovers: [
    ...heroHovers,
    {
      token: "json",
      within: "c.json",
      type: "(property) json: <201, InferObjectOutput<{ queued: BooleanSchema }>>(status: 201, data: { queued: boolean }) => Response",
    },
    {
      token: "queud",
      type: "(property) queud: boolean",
      error:
        "Object literal may only specify known properties, but 'queud' does not exist in type '{ queued: boolean; }'. Did you mean to write 'queued'?",
      errorCode: 2561,
    },
  ],
};

export const routeSample: CodeSample = {
  code: `import { Api } from "semola/api";
import { boolean, email, object } from "semola/schema";
import { emails } from "./jobs";

export const api = new Api({
  openapi: { title: "Accounts", version: "1.0.0" },
});

export const signup = api.defineRoute({
  path: "/signup",
  method: "POST",
  summary: "Create an account",
  tags: ["auth"],
  request: { body: object({ email: email() }) },
  response: { 201: object({ queued: boolean() }) },
  handler: async (c) => {
    await emails.enqueue({ to: c.req.body.email });
    return c.json(201, { queued: true });
  },
});`,
  hovers: [
    {
      token: "signup",
      type: "const signup: ClientRoute<{ body: ObjectSchema<{ email: StringSchema }> }, { 201: ObjectSchema<{ queued: BooleanSchema }> }>",
      doc: "The route handle. The client imports it to type calls.",
    },
    {
      token: "summary",
      type: "(property) summary?: string | undefined",
      doc: "Becomes the operation summary in the OpenAPI document.",
    },
    {
      token: "body",
      type: "(property) body: ObjectSchema<{ email: StringSchema }>",
      doc: "Validates the request body and types c.req.body.",
    },
    {
      token: "201",
      type: "(property) 201: ObjectSchema<{ queued: BooleanSchema }>",
      doc: "Checks c.json(201, ...) and types what the client receives.",
    },
    {
      token: "email",
      within: "body.email",
      type: "(property) email: string",
    },
  ],
};

export const clientSample: CodeSample = {
  code: `import { ApiClient } from "semola/api";
import { signup } from "./server";

const client = ApiClient({
  router: { auth: { signup } },
  baseUrl: "https://api.example.com",
});

const { queued } = await client.auth.signup({
  body: { email: "hi@semo.la" },
});

await client.auth.signup({
  body: { emial: "hi@semo.la" },
});`,
  hovers: [
    { token: "queued", type: "const queued: boolean" },
    {
      token: "signup",
      within: "signup({",
      type: "(property) signup: (input: { body: InferObjectOutput<{ email: StringSchema }> }) => Promise<InferObjectOutput<{ queued: BooleanSchema }>>",
    },
    {
      token: "body",
      type: "(property) body: InferObjectOutput<{ email: StringSchema }>",
    },
    {
      token: "emial",
      type: "(property) emial: string",
      error:
        "Object literal may only specify known properties, but 'emial' does not exist in type 'InferObjectOutput<{ email: StringSchema; }>'. Did you mean to write 'email'?",
      errorCode: 2561,
    },
  ],
};

export const openApiSample: CodeSample = {
  code: `{
  "/signup": {
    "post": {
      "summary": "Create an account",
      "tags": ["auth"],
      "requestBody": {
        "required": true,
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "email": { "type": "string", "format": "email" }
              },
              "required": ["email"]
            }
          }
        }
      },
      "responses": {
        "201": {
          "description": "Response with status 201",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "queued": { "type": "boolean" }
                },
                "required": ["queued"]
              }
            }
          }
        }
      }
    }
  }
}`,
  hovers: [
    { token: "summary", doc: "From summary on the route." },
    {
      token: "format",
      within: '"format": "email"',
      doc: "From email() in the request schema.",
    },
    {
      token: "queued",
      within: '"queued": {',
      doc: "From the 201 response schema.",
    },
  ],
};

export const testSample: CodeSample = {
  code: `import { expect, test } from "bun:test";
import { api } from "./server";

test("rejects an invalid email", async () => {
  const res = await api.fetch(
    new Request("http://localhost/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nope" }),
    }),
  );

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    message: "email: Invalid email",
  });
});`,
  hovers: [
    {
      token: "fetch",
      within: "api.fetch",
      type: "(property) Api<readonly [], undefined>.fetch: (req: Request) => Response | Promise<Response>",
      doc: "Dispatches a Request through the same route pipeline without opening a network port.",
    },
    { token: "res", type: "const res: Response" },
  ],
};

export const composerBase = {
  import: `import { Api } from "semola/api";`,
  start: `
const api = new Api();`,
  end: `
api.serve(3000);`,
};

export const composerModules = [
  {
    id: "queue",
    label: "Queue",
    import: `import { Queue } from "semola/queue";`,
    code: `
const emails = new Queue<{ to: string }>({
  name: "emails",
  redis: redisClient,
  handler: async (job) => sendWelcomeEmail(job.to),
});`,
    hovers: [{ token: "emails", type: "const emails: Queue<{ to: string }>" }],
  },
  {
    id: "cron",
    label: "Cron",
    import: `import { Cron } from "semola/cron";`,
    code: `
const digest = new Cron({
  name: "weekly-digest",
  schedule: "@weekly",
  handler: async () => sendDigest(),
});`,
    hovers: [{ token: "digest", type: "const digest: Cron" }],
  },
  {
    id: "cache",
    label: "Cache",
    import: `import { Cache } from "semola/cache";`,
    code: `
const sessions = new Cache<{ userId: string }>({
  redis: redisClient,
  ttl: 60_000,
});`,
    hovers: [
      { token: "sessions", type: "const sessions: Cache<{ userId: string }>" },
    ],
  },
  {
    id: "policy",
    label: "Policy",
    import: `import { eq, Policy } from "semola/policy";`,
    code: `
type Post = { status: "draft" | "published" };

const posts = new Policy<Post>();

posts.forbid({
  action: "delete",
  conditions: { status: eq("published") },
});`,
    hovers: [{ token: "posts", type: "const posts: Policy<Post>" }],
  },
  {
    id: "i18n",
    label: "i18n",
    import: `import { I18n } from "semola/i18n";`,
    code: `
const i18n = new I18n({
  defaultLocale: "en",
  locales: { en: { welcome: "Welcome, {name:string}!" } },
});`,
    hovers: [
      {
        token: "i18n",
        within: "const i18n",
        type: 'const i18n: I18n<{ readonly en: { readonly welcome: "Welcome, {name:string}!" } }, "en">',
      },
    ],
  },
  {
    id: "logging",
    label: "Logging",
    import: `import { ConsoleProvider, Logger } from "semola/logging";`,
    code: `
const log = new Logger("api", [new ConsoleProvider()]);`,
    hovers: [{ token: "log", within: "const log", type: "const log: Logger" }],
  },
];

const ormCode = (
  field: string,
) => `import { createOrm, defineTable, string, uuid } from "semola/orm";

const users = defineTable({
  sqlName: "users",
  columns: {
    id: uuid("id").primaryKey().notNull(),
    email: string("email").unique().notNull(),
  },
});

const db = createOrm({
  adapter: "sqlite",
  url: ":memory:",
  tables: { users },
});

const user = await db.users.findFirst({
  where: { email: "hi@semo.la" },
});

console.log(user?.${field});`;

const workflowCode = (
  orderId: string,
) => `import { defineWorkflow } from "semola/workflow";

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

await fulfillOrder.start({ orderId: ${orderId} });`;

const pubsubCode = (action: string) => `import { PubSub } from "semola/pubsub";

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

await events.publish({ userId: "123", action: "${action}" });`;

const errorsCode = (
  onError: string,
) => `import { mightThrow } from "semola/errors";

export const loadMe = async () => {
  const [error, response] = await mightThrow(
    fetch("https://api.example.com/me"),
  );

  if (error) {
    console.error(error.message);${onError}
  }

  return response.json();
};`;

const cliCode = (tagSchema: string) => `import { CLI } from "semola/cli";
import { boolean, ${tagSchema} } from "semola/schema";

const program = new CLI({ name: "deploy", version: "1.0.0" });

program
  .command("release")
  .argument("tag", { schema: ${tagSchema}() })
  .option("dryRun", { schema: boolean(), aliases: ["d"] })
  .action((args, options) => {
    console.log(args.tag.toUpperCase(), options.dryRun);
  });

await program.parse();`;

const queueCode = (job: string) => `import { Queue } from "semola/queue";

type EmailJob = {
  to: string;
  subject: string;
};

const emails = new Queue<EmailJob>({
  name: "emails",
  redis: redisClient,
  concurrency: 4,
  retries: 3,
  handler: async (data) => {
    await sendEmail(data.to, data.subject);
  },
});

await emails.enqueue(${job});`;

const cacheCode = (role: string) => `import { Cache } from "semola/cache";

type Session = {
  userId: string;
  role: "admin" | "member";
};

const sessions = new Cache<Session>({
  redis: redisClient,
  prefix: "session",
  ttl: (_key, session) => {
    if (session.role === "admin") return 3_600_000;

    return 60_000;
  },
});

await sessions.set("abc", { userId: "u_1", role: "${role}" });

const session = await sessions.get("abc");`;

const policyCode = (
  field: string,
) => `import { eq, Policy } from "semola/policy";

type Post = {
  authorId: string;
  status: "draft" | "published";
};

const posts = new Policy<Post>();

posts.allow({
  action: ["update", "delete"],
  conditions: { authorId: eq(user.id) },
});

posts.forbid({
  action: "delete",
  conditions: { ${field}: eq("published") },
  reason: "Published posts cannot be deleted",
});

const result = posts.can("delete", post);`;

const i18nCode = (key: string) => `import { I18n } from "semola/i18n";

const i18n = new I18n({
  defaultLocale: "en",
  locales: {
    en: {
      welcome: "Welcome, {name:string}!",
      inbox: { unread: "You have {count:number} unread messages" },
    },
    it: {
      welcome: "Benvenuto, {name:string}!",
    },
  },
});

i18n.setLocale("it");

const unread = i18n.translate("${key}", { count: 3 });`;

const jobDataHover: CodeHover = {
  token: "data",
  within: "(data)",
  type: "(parameter) data: EmailJob",
  doc: "Typed from the queue, so enqueue and the handler agree on the payload.",
};

const sessionHover: CodeHover = {
  token: "session",
  within: "_key, session",
  type: "(parameter) session: Session",
};

const canResultHover: CodeHover = {
  token: "result",
  within: "const result",
  type: "const result: CanResult",
  doc: "Forbid rules are checked first. No matching rule means denied.",
};

const userEmailHover: CodeHover = {
  token: "email",
  within: "user?.email",
  type: "(property) email: string | undefined",
  doc: "Inferred from the column definition. No codegen, no casts.",
};

const paymentHover: CodeHover = {
  token: "payment",
  type: "const payment: { orderId: string; amount: number }",
  doc: "Saved after the step runs. A retry reads it back instead of charging twice.",
};

const messageHover: CodeHover = {
  token: "message",
  type: "(parameter) message: UserEvent",
};

const errorHover: CodeHover = {
  token: "error",
  within: "const [error",
  type: "const error: Error | null",
};

const argsHover = (tagType: string): CodeHover => ({
  token: "args",
  within: "(args",
  type: `(parameter) args: Record<string, unknown> & Record<"tag", ${tagType}>`,
});

export const moduleExamples: ModuleExample[] = [
  {
    pkg: "semola/orm",
    label: "ORM",
    href: "/docs/orm",
    title: "SQL with types that follow the table",
    body: "Define a table once. Queries, inserts, relations, and transactions infer from it on SQLite or Postgres, and the migration CLI writes the SQL from the same definition.",
    file: "db.ts",
    breakLabel: "Read a missing column",
    sample: {
      code: ormCode("email"),
      hovers: [userEmailHover],
    },
    broken: {
      code: ormCode("name"),
      hovers: [
        {
          token: "name",
          within: "user?.name",
          error:
            "Property 'name' does not exist on type '{ readonly id: string; readonly email: string; }'.",
          errorCode: 2339,
        },
      ],
    },
  },
  {
    pkg: "semola/queue",
    label: "Queue",
    href: "/docs/queue",
    title: "Background jobs that retry on their own",
    body: "Jobs are stored in Redis, retried with backoff when a handler throws, and reclaimed if a worker dies mid-job. The payload type follows the job from enqueue to handler.",
    file: "jobs.ts",
    breakLabel: "Forget the subject",
    sample: {
      code: queueCode(`{ to: "hi@semo.la", subject: "Welcome" }`),
      hovers: [
        jobDataHover,
        { token: "emails", type: "const emails: Queue<EmailJob>" },
      ],
    },
    broken: {
      code: queueCode(`{ to: "hi@semo.la" }`),
      hovers: [
        jobDataHover,
        {
          token: `{ to: "hi@semo.la" }`,
          error:
            "Property 'subject' is missing in type '{ to: string; }' but required in type 'EmailJob'.",
          errorCode: 2741,
        },
      ],
    },
  },
  {
    pkg: "semola/workflow",
    label: "Workflow",
    href: "/docs/workflow",
    title: "Multi-step work that survives a crash",
    body: "Name each step and its result is saved in Redis. If a process dies mid-run, another one picks the execution up and skips the steps that already finished.",
    file: "order.ts",
    breakLabel: "Start it with a number",
    sample: {
      code: workflowCode(`"ord_123"`),
      hovers: [
        paymentHover,
        { token: "input", type: "(parameter) input: { orderId: string }" },
      ],
    },
    broken: {
      code: workflowCode("123"),
      hovers: [
        paymentHover,
        {
          token: "orderId",
          within: "orderId: 123",
          type: "(property) orderId: string",
          error: "Type 'number' is not assignable to type 'string'.",
          errorCode: 2322,
        },
      ],
    },
  },
  {
    pkg: "semola/cache",
    label: "Cache",
    href: "/docs/cache",
    title: "A Redis cache that knows its value type",
    body: "Give the cache a type once and every set and get is checked against it. TTLs can be fixed or computed per entry, and a prefix keeps keys apart.",
    file: "sessions.ts",
    breakLabel: "Store an unknown role",
    sample: {
      code: cacheCode("member"),
      hovers: [
        sessionHover,
        {
          token: "session",
          within: "const session =",
          type: "const session: Session",
          doc: "get() throws on a miss, so the value is never undefined.",
        },
      ],
    },
    broken: {
      code: cacheCode("owner"),
      hovers: [
        sessionHover,
        {
          token: "role",
          within: 'role: "owner"',
          type: '(property) role: "admin" | "member"',
          error: `Type '"owner"' is not assignable to type '"admin" | "member"'.`,
          errorCode: 2322,
        },
      ],
    },
  },
  {
    pkg: "semola/pubsub",
    label: "PubSub",
    href: "/docs/pubsub",
    title: "Events with a type on both ends",
    body: "Publishers and subscribers share one message type, so renaming a field breaks the build instead of a consumer in production.",
    file: "events.ts",
    breakLabel: "Publish an unknown action",
    sample: {
      code: pubsubCode("login"),
      hovers: [messageHover],
    },
    broken: {
      code: pubsubCode("signup"),
      hovers: [
        messageHover,
        {
          token: "action",
          within: 'action: "signup"',
          type: '(property) action: "login" | "logout"',
          error:
            'Type \'"signup"\' is not assignable to type \'"login" | "logout"\'.',
          errorCode: 2322,
        },
      ],
    },
  },
  {
    pkg: "semola/policy",
    label: "Policy",
    href: "/docs/policy",
    title: "Authorization rules you can read",
    body: "Allow and forbid rules match on the fields of your own types. Forbid always wins, and anything without a matching rule is denied.",
    file: "posts.ts",
    breakLabel: "Match a field that does not exist",
    sample: {
      code: policyCode("status"),
      hovers: [canResultHover],
    },
    broken: {
      code: policyCode("state"),
      hovers: [
        canResultHover,
        {
          token: "state",
          error:
            "Object literal may only specify known properties, and 'state' does not exist in type 'Conditions<Post>'.",
          errorCode: 2353,
        },
      ],
    },
  },
  {
    pkg: "semola/i18n",
    label: "i18n",
    href: "/docs/i18n",
    title: "Translation keys the compiler checks",
    body: "Keys and placeholders are inferred from the default locale, so a typo fails the build. Missing translations fall back to the default language at runtime.",
    file: "i18n.ts",
    breakLabel: "Misspell a key",
    sample: {
      code: i18nCode("inbox.unread"),
      hovers: [
        {
          token: "count",
          within: "{ count: 3 }",
          type: "(property) count: number",
          doc: "Typed from {count:number} in the English message.",
        },
      ],
    },
    broken: {
      code: i18nCode("inbox.unred"),
      hovers: [
        {
          token: '"inbox.unred"',
          error: `Argument of type '"inbox.unred"' is not assignable to parameter of type '"inbox.unread" | "welcome"'.`,
          errorCode: 2345,
        },
      ],
    },
  },
  {
    pkg: "semola/errors",
    label: "Errors",
    href: "/docs/errors",
    title: "Failures you handle on purpose",
    body: "mightThrow turns a promise into an [error, data] tuple. Handle the failure first, and the compiler knows the data is safe to use after that.",
    file: "me.ts",
    breakLabel: "Forget to return",
    sample: {
      code: errorsCode("\n    return;"),
      hovers: [
        errorHover,
        {
          token: "response",
          within: "return response",
          type: "const response: Response",
          doc: "Narrowed after the error branch returns.",
        },
      ],
    },
    broken: {
      code: errorsCode(""),
      hovers: [
        errorHover,
        {
          token: "response",
          within: "return response",
          type: "const response: Response | null",
          error: "'response' is possibly 'null'.",
          errorCode: 18047,
        },
      ],
    },
  },
  {
    pkg: "semola/cli",
    label: "CLI",
    href: "/docs/cli",
    title: "Command-line tools with typed flags",
    body: "Arguments and options are validated with any Standard Schema, and the action receives them already typed.",
    file: "deploy.ts",
    breakLabel: "Make the tag a number",
    sample: {
      code: cliCode("string"),
      hovers: [
        argsHover("string"),
        {
          token: "options",
          within: ", options)",
          type: '(parameter) options: Record<string, unknown> & Record<"dryRun", boolean>',
        },
      ],
    },
    broken: {
      code: cliCode("number"),
      hovers: [
        argsHover("number"),
        {
          token: "toUpperCase",
          error: "Property 'toUpperCase' does not exist on type 'number'.",
          errorCode: 2339,
        },
      ],
    },
  },
];
