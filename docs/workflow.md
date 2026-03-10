# Workflow

Durable and resumable workflows backed by Redis.

## Import

```typescript
import { defineWorkflow } from "semola/workflow";
```

## Basic Usage

```typescript
type User = {
  id: number;
  email: string;
};

const onboardUser = defineWorkflow<User, void>({
  name: "onboard-user",
  redis: redisClient,
  handler: async ({ input, step }) => {
    const user = await step("get-user-from-db", async () => {
      return db.users.getById(input.id);
    });

    await step("send-email", async () => {
      await emailClient.send(input.email, `Welcome, ${user.fullName}!`);
    });
  },
});

const [startError, started] = await onboardUser.start({
  id: 1,
  email: "leo@example.com",
});
```

## Why It Is Durable

Each step persists its output in Redis using the step name as key.

If a workflow crashes after one or more completed steps:
- calling `resume(executionId)` reruns the handler
- completed steps are loaded from Redis and skipped
- execution continues from the first unfinished step

## API

- `start(input, options?)` starts a new execution and runs inline.
- `run(input, options?)` starts and returns the typed workflow result.
- `resume(executionId)` resumes a failed or interrupted execution.
- `get(executionId)` returns execution status, timestamps, and completed steps.
- `cancel(executionId)` marks execution as cancelled.

## Notes

- Step names should be stable and unique inside a workflow handler.
- Semantics are at-least-once for side effects.
- Keep step handlers idempotent whenever possible.
