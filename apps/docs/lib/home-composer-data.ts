export const composerBase = {
  import: `import { Api } from "semola/api";`,
  start: `
const api = new Api();

export const signup = api.defineRoute({
  path: "/signup",
  method: "POST",`,
  handler: `  handler: async (c) => {
    const { email, name } = c.req.body;
    let message = \`Welcome, \${name}!\`;`,
  end: `
    return c.json(201, { ok: true, message });
  },
});

api.serve(3000);`,
};

export const composerModules = [
  {
    id: "schema",
    label: "Schema",
    file: {
      name: "signup.schema.ts",
      code: `import { s } from "semola/schema";

export const signupBody = s.object({
  email: s.email(),
  name: s.string(),
});

export const signupCreated = s.object({
  ok: s.boolean(),
  message: s.string(),
});`,
    },
    import: `import { signupBody, signupCreated } from "./signup.schema.ts";`,
    route: `  request: { body: signupBody },
  response: { 201: signupCreated },`,
    step: "",
    hovers: [
      {
        token: "object",
        within: "s.object",
        type: "s.object(shape): ObjectSchema",
        doc: "Schema defined in its own file, then plugged into the route.",
      },
    ],
  },
  {
    id: "queue",
    label: "Queue",
    typeName: "EmailJob",
    typeDef: `export type EmailJob = {
  to: string;
  name: string;
};`,
    file: {
      name: "emails.queue.ts",
      code: `import { Queue } from "semola/queue";
import type { EmailJob } from "./types.ts";

export const emails = new Queue<EmailJob>({
  name: "emails",
  redis: redisClient,
  handler: async (job) => sendWelcomeEmail(job.to, job.name),
});`,
    },
    import: `import { emails } from "./emails.queue.ts";`,
    route: "",
    step: `    await emails.enqueue({ to: email, name });`,
    hovers: [
      {
        token: "enqueue",
        type: "enqueue(data: EmailJob)",
        doc: "Same payload type as the worker. Fired from the route handler.",
      },
    ],
  },
  {
    id: "cache",
    label: "Cache",
    typeName: "Profile",
    typeDef: `export type Profile = {
  name: string;
};`,
    file: {
      name: "profiles.cache.ts",
      code: `import { Cache } from "semola/cache";
import type { Profile } from "./types.ts";

export const profiles = new Cache<Profile>({
  redis: redisClient,
  prefix: "profile",
  ttl: 60_000,
});`,
    },
    import: `import { profiles } from "./profiles.cache.ts";`,
    route: "",
    step: `    await profiles.set(email, { name });`,
    hovers: [
      {
        token: "set",
        within: "profiles.set",
        type: "set(key: string, value: Profile)",
        doc: "Cache the profile right after signup - typed value, one Redis round trip.",
      },
    ],
  },
  {
    id: "workflow",
    label: "Workflow",
    typeName: "OnboardInput",
    typeDef: `export type OnboardInput = {
  email: string;
  name: string;
};`,
    file: {
      name: "onboard.workflow.ts",
      code: `import { defineWorkflow } from "semola/workflow";
import type { OnboardInput } from "./types.ts";

export const onboard = defineWorkflow<OnboardInput>({
  name: "onboard",
  redis: redisClient,
  handler: async ({ input, step }) => {
    await step("provision", async () => createWorkspace(input.email));
    await step("invite", async () => inviteToWorkspace(input.email));
  },
});`,
    },
    import: `import { onboard } from "./onboard.workflow.ts";`,
    route: "",
    step: `    await onboard.start({ email, name });`,
    hovers: [
      {
        token: "start",
        within: "onboard.start",
        type: "start(input: OnboardInput)",
        doc: "Kicks off durable steps. Survives crashes; finished steps are not re-run.",
      },
    ],
  },
  {
    id: "policy",
    label: "Policy",
    typeName: "Account",
    typeDef: `export type Account = {
  plan: "free" | "pro";
};`,
    file: {
      name: "accounts.policy.ts",
      code: `import { eq, Policy } from "semola/policy";
import type { Account } from "./types.ts";

export const accounts = new Policy<Account>();

accounts.allow({
  action: "signup",
  conditions: { plan: eq("free") },
});`,
    },
    import: `import { accounts } from "./accounts.policy.ts";`,
    route: "",
    step: `    if (!accounts.can("signup", { plan: "free" }).allowed) {
      throw new Error("signup forbidden");
    }`,
    hovers: [
      {
        token: "can",
        within: "accounts.can",
        type: 'can(action: "signup", resource: Account)',
        doc: "Gate first in the handler so forbidden signups never enqueue, cache, or start work.",
      },
    ],
  },
  {
    id: "i18n",
    label: "i18n",
    file: {
      name: "i18n.ts",
      code: `import { I18n } from "semola/i18n";

export const i18n = new I18n({
  defaultLocale: "en",
  locales: {
    en: {
      welcome: "Welcome, {name:string}!",
      "errors.forbidden": "You cannot sign up with that plan.",
    },
  },
});`,
    },
    import: `import { i18n } from "./i18n.ts";`,
    route: "",
    step: `    message = i18n.translate("welcome", { name });`,
    hovers: [
      {
        token: "translate",
        type: 'translate("welcome", { name: string })',
        doc: "Replaces the default message with a typed translation before the response is sent.",
      },
    ],
  },
  {
    id: "logging",
    label: "Logging",
    file: {
      name: "logger.ts",
      code: `import { ConsoleProvider, Logger } from "semola/logging";

export const log = new Logger("api", [new ConsoleProvider()]);`,
    },
    import: `import { log } from "./logger.ts";`,
    route: "",
    step: `    log.info("signup", { email, name, message });`,
    hovers: [
      {
        token: "info",
        within: "log.info",
        type: "info(message: string, fields?: object)",
        doc: "Logs the same message the client receives - works with or without i18n.",
      },
    ],
  },
];
