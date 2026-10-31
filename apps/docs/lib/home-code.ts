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

const signupRoute = ({
  status = 201,
  response = "queued",
}: {
  status?: number;
  response?: string;
} = {}) => `import { Api } from "semola/api";
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
    return c.json(${status}, { ${response}: true });
  },
});

api.serve(3000);`;

const heroHovers: CodeHover[] = [
  {
    token: "Queue",
    within: "{ Queue }",
    type: 'import { Queue }',
    doc: "Typed jobs on Redis. The payload shape is the Queue generic - one place, not a second schema file.",
  },
  {
    token: "emails",
    type: "Queue<{ to: string }>",
    doc: "Only jobs with { to: string } can be enqueued. Wrong fields fail in the editor.",
  },
  {
    token: "job",
    type: "job: { to: string }",
    doc: "Handler input matches the Queue generic. No casting out of Redis.",
  },
  {
    token: "Api",
    within: "new Api()",
    type: "new Api()",
    doc: "One router. defineRoute feeds validation, handler types, OpenAPI, and the typed client.",
  },
  {
    token: "defineRoute",
    type: "api.defineRoute(route)",
    doc: "Declare path, body, and responses once. Everything else is inferred from this object.",
  },
  {
    token: "email",
    within: "email()",
    type: "email(): StringSchema",
    doc: "Any Standard Schema works here - Zod, Valibot, ArkType, or semola/schema.",
  },
  {
    token: "enqueue",
    type: "enqueue(data: { to: string }): Promise<string>",
    doc: "Payload checked against the Queue type. Returns the job id.",
  },
  {
    token: "email",
    within: "body.email",
    type: "email: string",
    doc: "Already validated against the request schema. The handler never sees a raw body.",
  },
  {
    token: "serve",
    type: "serve(port: number): void",
    doc: "Bun HTTP server. Same Api instance you defined routes on.",
  },
];

const heroJsonHover: CodeHover = {
  token: "json",
  within: "c.json",
  type: "json(status, data): Response",
  doc: "Status and body must match the response map. A typo or wrong code fails before you run it.",
};

export const heroSample: CodeSample = {
  code: signupRoute(),
  hovers: [
    ...heroHovers,
    heroJsonHover,
    {
      token: "queued",
      within: "{ queued: true }",
      type: "queued: boolean",
      doc: "Matches response: { 201: object({ queued: boolean() }) }. Rename it and TypeScript complains.",
    },
  ],
};

export const heroTypoSample: CodeSample = {
  code: signupRoute({ response: "queud" }),
  hovers: [
    ...heroHovers,
    heroJsonHover,
    {
      token: "queud",
      type: "queud: boolean",
      error:
        "Object literal may only specify known properties, but 'queud' does not exist in type '{ queued: boolean; }'. Did you mean to write 'queued'?",
      errorCode: 2561,
      doc: "Response body is checked against the route schema - same definition the client will see.",
    },
  ],
};

export const heroStatusSample: CodeSample = {
  code: signupRoute({ status: 200 }),
  hovers: [
    ...heroHovers,
    {
      token: "200",
      within: "c.json(200",
      type: "200",
      error:
        "Argument of type '200' is not assignable to parameter of type '201'.",
      errorCode: 2345,
      doc: "Only statuses listed in response are allowed. Add 200 to the map, or return 201.",
    },
    {
      token: "queued",
      within: "{ queued: true }",
      type: "queued: boolean",
      doc: "Body shape is fine - the status is the problem.",
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
      type: "const signup: ClientRoute",
      doc: "Export this handle. The client imports it and gets typed calls for free.",
    },
    {
      token: "summary",
      type: "summary?: string",
      doc: "Becomes the operation summary in the OpenAPI document.",
    },
    {
      token: "body",
      type: "body: object({ email })",
      doc: "Validates the request and types c.req.body from the same schema.",
    },
    {
      token: "201",
      type: "201: object({ queued })",
      doc: "Checks c.json(201, ...) and types what the client receives.",
    },
    {
      token: "email",
      within: "body.email",
      type: "email: string",
      doc: "Already validated. No casting out of the request.",
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
    {
      token: "queued",
      type: "queued: boolean",
      doc: "Destructured from the 201 response schema on the server route.",
    },
    {
      token: "signup",
      within: "signup({",
      type: "signup(input): Promise<{ queued: boolean }>",
      doc: "Same defineRoute handle. No OpenAPI codegen step.",
    },
    {
      token: "body",
      type: "body: { email: string }",
      doc: "Request body typed from the route. Extra or missing fields fail here.",
    },
    {
      token: "emial",
      type: "emial: string",
      error:
        "Object literal may only specify known properties, but 'emial' does not exist in type '{ email: string }'. Did you mean to write 'email'?",
      errorCode: 2561,
      doc: "A typo on the client is a type error - caught before you hit send.",
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
      type: "fetch(req: Request): Promise<Response>",
      doc: "Same middleware, validation, and handler - no open port, no network hop.",
    },
    {
      token: "res",
      type: "res: Response",
      doc: "Status and JSON match what production would return for this Request.",
    },
  ],
};

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
  type: "data: EmailJob",
  doc: "Typed from the Queue generic - enqueue and the handler share one payload shape.",
};

const sessionHover: CodeHover = {
  token: "session",
  within: "_key, session",
  type: "session: Session",
  doc: "TTL callback sees the typed value, so admin vs member can expire differently.",
};

const canResultHover: CodeHover = {
  token: "result",
  within: "const result",
  type: "result: CanResult",
  doc: "Forbid rules win first. No matching rule means denied - no accidental open door.",
};

const userEmailHover: CodeHover = {
  token: "email",
  within: "user?.email",
  type: "email: string | undefined",
  doc: "Inferred from the column definition. No codegen, no casts.",
};

const paymentHover: CodeHover = {
  token: "payment",
  type: "payment: { orderId: string; amount: number }",
  doc: "Saved after the step runs. A retry reads it back instead of charging twice.",
};

const messageHover: CodeHover = {
  token: "message",
  type: "message: UserEvent",
  doc: "Publish and subscribe share this shape. Rename a field and both ends fail the build.",
};

const errorHover: CodeHover = {
  token: "error",
  within: "const [error",
  type: "error: Error | null",
  doc: "Handle the failure branch first. After that, data is narrowed.",
};

const argsHover = (tagType: string): CodeHover => ({
  token: "args",
  within: "(args",
  type: `args: { tag: ${tagType} }`,
  doc: "Validated by the argument schema before your action runs.",
});

export const moduleExamples: ModuleExample[] = [
  {
    pkg: "semola/orm",
    label: "ORM",
    href: "/docs/orm",
    title: "Define the table. The types come along.",
    body: "One table definition drives queries, inserts, relations, and transactions on SQLite or Postgres. The migration CLI writes SQL from the same shape - no parallel schema to drift.",
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
            "Property 'name' does not exist on type '{ id: string; email: string }'.",
          errorCode: 2339,
          doc: "Only columns from defineTable exist on the row. No silent undefined.",
        },
      ],
    },
  },
  {
    pkg: "semola/queue",
    label: "Queue",
    href: "/docs/queue",
    title: "Enqueue it. Retries are already handled.",
    body: "Jobs live in Redis. Handlers that throw get backoff retries; dead workers get their jobs reclaimed. The payload type is the same from enqueue to the handler.",
    file: "jobs.ts",
    breakLabel: "Forget the subject",
    sample: {
      code: queueCode(`{ to: "hi@semo.la", subject: "Welcome" }`),
      hovers: [
        jobDataHover,
        {
          token: "emails",
          type: "Queue<EmailJob>",
          doc: "Payload type is EmailJob from enqueue through the handler.",
        },
      ],
    },
    broken: {
      code: queueCode(`{ to: "hi@semo.la" }`),
      hovers: [
        jobDataHover,
        {
          token: `{ to: "hi@semo.la" }`,
          error:
            "Property 'subject' is missing in type '{ to: string }' but required in type 'EmailJob'.",
          errorCode: 2741,
          doc: "Incomplete payloads fail at enqueue time, not in the worker at 2am.",
        },
      ],
    },
  },
  {
    pkg: "semola/workflow",
    label: "Workflow",
    href: "/docs/workflow",
    title: "Crash mid-run. Pick up where you left off.",
    body: "Each named step saves its result in Redis. If the process dies, another worker resumes and skips steps that already finished - no double charge, no blank stare.",
    file: "order.ts",
    breakLabel: "Start it with a number",
    sample: {
      code: workflowCode(`"ord_123"`),
      hovers: [
        paymentHover,
        {
          token: "input",
          type: "input: { orderId: string }",
          doc: "Workflow input is the generic on defineWorkflow.",
        },
      ],
    },
    broken: {
      code: workflowCode("123"),
      hovers: [
        paymentHover,
        {
          token: "orderId",
          within: "orderId: 123",
          type: "orderId: string",
          error: "Type 'number' is not assignable to type 'string'.",
          errorCode: 2322,
          doc: "start() is checked against the workflow input type.",
        },
      ],
    },
  },
  {
    pkg: "semola/cache",
    label: "Cache",
    href: "/docs/cache",
    title: "Cache values with a real TypeScript type",
    body: "Set the value type once; every set and get is checked against it. Fixed or per-entry TTLs, plus a key prefix so namespaces stay out of each other's way.",
    file: "sessions.ts",
    breakLabel: "Store an unknown role",
    sample: {
      code: cacheCode("member"),
      hovers: [
        sessionHover,
        {
          token: "session",
          within: "const session =",
          type: "session: Session",
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
          type: 'role: "admin" | "member"',
          error: `Type '"owner"' is not assignable to type '"admin" | "member"'.`,
          errorCode: 2322,
          doc: "set() rejects values outside the Cache generic.",
        },
      ],
    },
  },
  {
    pkg: "semola/pubsub",
    label: "PubSub",
    href: "/docs/pubsub",
    title: "Publish and subscribe on the same type",
    body: "Both ends share one message shape. Rename a field and the build fails - better than a silent consumer in production.",
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
          type: 'action: "login" | "logout"',
          error:
            'Type \'"signup"\' is not assignable to type \'"login" | "logout"\'.',
          errorCode: 2322,
          doc: "Publish payload must match the PubSub generic.",
        },
      ],
    },
  },
  {
    pkg: "semola/policy",
    label: "Policy",
    href: "/docs/policy",
    title: "Auth rules you can read out loud",
    body: "Allow and forbid rules match fields on your own types. Forbid always wins. No matching rule means denied - no accidental open doors.",
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
          doc: "Condition keys must be fields on Post - no inventing columns.",
        },
      ],
    },
  },
  {
    pkg: "semola/i18n",
    label: "i18n",
    href: "/docs/i18n",
    title: "Misspell a key. Fail the build.",
    body: "Keys and placeholders come from the default locale, so typos are type errors. Missing translations fall back at runtime instead of showing a blank string.",
    file: "i18n.ts",
    breakLabel: "Misspell a key",
    sample: {
      code: i18nCode("inbox.unread"),
      hovers: [
        {
          token: "count",
          within: "{ count: 3 }",
          type: "count: number",
          doc: "Placeholder typed from {count:number} in the English message.",
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
          doc: "Keys are a union from the default locale. Typos fail the build.",
        },
      ],
    },
  },
  {
    pkg: "semola/errors",
    label: "Errors",
    href: "/docs/errors",
    title: "Handle the error branch on purpose",
    body: "mightThrow turns a promise into an [error, data] tuple. Deal with the failure first; after that the compiler knows data is safe to use.",
    file: "me.ts",
    breakLabel: "Forget to return",
    sample: {
      code: errorsCode("\n    return;"),
      hovers: [
        errorHover,
        {
          token: "response",
          within: "return response",
          type: "response: Response",
          doc: "Narrowed after the error branch returns - safe to use.",
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
          type: "response: Response | null",
          error: "'response' is possibly 'null'.",
          errorCode: 18047,
          doc: "Skip the error return and TypeScript keeps response nullable.",
        },
      ],
    },
  },
  {
    pkg: "semola/cli",
    label: "CLI",
    href: "/docs/cli",
    title: "CLIs whose flags arrive already typed",
    body: "Arguments and options go through any Standard Schema. By the time your action runs, the values are validated and typed - no manual argv parsing.",
    file: "deploy.ts",
    breakLabel: "Make the tag a number",
    sample: {
      code: cliCode("string"),
      hovers: [
        argsHover("string"),
        {
          token: "options",
          within: ", options)",
          type: "options: { dryRun: boolean }",
          doc: "Options are validated schemas too - aliases included.",
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
          doc: "Change the argument schema and the action types follow.",
        },
      ],
    },
  },
];
