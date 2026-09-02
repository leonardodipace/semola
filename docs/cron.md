---
title: Cron
description: In-process and OS-level cron schedules on Bun
---

Schedule work either in-process or through the operating system. `Cron` runs a handler inside the current Bun process. `CronOS` registers a script with Bun's OS-level cron helper so it runs independently of the current process. `CronDistributed` runs an in-process handler like `Cron`, but uses Redis so only one replica executes each scheduled tick.

## Import

```typescript
import { Cron, CronDistributed, CronOS, cronJobBuilder, any, number } from "semola/cron";
```

## Quick start

This starts an in-process daily handler. Calling `stop()` later cancels its timer.

```typescript
const daily = new Cron({
  name: "daily-report",
  schedule: "@daily",
  handler: async () => {
    await sendReport();
  },
});

daily.run();

// later
daily.stop();
```

## Schedules

### Aliases

`@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight`, `@hourly`, `@minutely`. You can also pass a standard cron expression string.

### Builder

For typed schedule pieces:

This builds a Monday-Friday 09:00 expression and gives it to an in-process job.

```typescript
import {
  cronJobBuilder,
  any,
  list,
  number,
  range,
  step,
  Month,
  WeekDay,
} from "semola/cron";

const schedule = cronJobBuilder((b) =>
  b
    .minute(number(0))
    .hour(number(9))
    .weekday(range({ min: WeekDay.mon, max: WeekDay.fri })),
);

const job = new Cron({
  name: "weekday-nudge",
  schedule,
  handler: () => console.log("good morning"),
});
```

Helpers: `any`, `list`, `number`, `range`, `step`, plus `Month` and `WeekDay` enums. Unset fields default to `*`.

`list()` selects exact values, `range()` selects an inclusive span, and `step()` repeats through a span at a fixed interval.

```typescript
const schedule = cronJobBuilder((b) =>
  b
    .minute(step({ range: { min: 0, max: 59 }, step: 15 }))
    .hour(list((values) => values.number(9).number(17)))
    .day(range({ min: 1, max: 7 }))
    .month(number(Month.jan))
    .weekday(number(WeekDay.mon)),
);
```

### Lifecycle

`next()` returns the next fire time, or `null` if there is no match. `ref()` / `unref()` control whether the timer keeps the process alive. `getStatus()`, `getExpression()`, and `getJobName()` inspect the job. Disposing the instance (`Symbol.dispose`) calls `stop`.

## OS crontab

`CronOS` registers a job with Bun's OS cron helper. It needs a script `path`, plus `name` and `schedule` (no in-process handler):

This registers `backup.ts` at OS level, then removes that registration.

```typescript
import { CronOS } from "semola/cron";

const job = new CronOS({
  name: "nightly-backup",
  schedule: "@daily",
  path: "./scripts/backup.ts",
});

await job.run();
await job.stop();
```

## Distributed cron

In a multi-replica deployment, plain `Cron` runs the handler on every replica. `CronDistributed` wraps the same in-process schedule with a Redis lock keyed by job name and tick, so only one replica runs each fire time.

Each replica still schedules locally. When a tick fires, the replica that acquires `SET key NX PX` runs the handler; the others skip that tick.

```typescript
import { CronDistributed } from "semola/cron";

const report = new CronDistributed({
  name: "daily-report",
  schedule: "@daily",
  redis,
  handler: async () => {
    await sendReport();
  },
});

report.run();
```

Use `replicaId` to identify the lock owner in Redis (defaults to a random UUID). `lockTTL` (default five minutes) only covers the race window when replicas compete for the same tick, not the full handler runtime.

Use a unique `name` per job. Two jobs with the same `name` but different schedules are not deduplicated against each other unless their ticks align on the same wall-clock instant.

```typescript
const cleanup = new CronDistributed({
  name: "cleanup",
  schedule: "@hourly",
  redis,
  replicaId: process.env.REPLICA_ID,
  handler: async () => {
    await purgeStaleRows();
  },
});
```

`CronDistributed` shares `run()`, `stop()`, `next()`, `ref()`, `unref()`, `getStatus()`, `getExpression()`, and `getJobName()` with `Cron`. Disposing the instance calls `stop()`.

## Examples

### Start an in-process job with `run()`

`run()` schedules the handler in the current process. Repeated calls while it is running do nothing.

```typescript
const cleanup = new Cron({
  name: "cleanup-temp",
  schedule: "@hourly",
  handler: async () => {
    await clearTempFiles();
  },
});

cleanup.run();
```

### Stop an in-process job with `stop()`

`stop()` cancels the active timer and returns the job to `idle`.

```typescript
cleanup.stop();
```

### Read the next run with `next()`

`next()` parses the schedule and returns its next matching `Date`, or `null` if there is no match (for example an impossible date). Pass a date or timestamp to calculate from another starting point.

```typescript
const everyFiveMinutes = new Cron({
  name: "sync",
  schedule: "*/5 * * * *",
  handler: async () => {
    await syncRemote();
  },
});

everyFiveMinutes.run();
console.log(everyFiveMinutes.next());
```

### Build a schedule with `cronJobBuilder()`

The builder combines typed fields into a cron expression. Unset fields remain `*`.

```typescript
const mondayMorning = new Cron({
  name: "monday-standup",
  schedule: cronJobBuilder((b) =>
    b.minute(number(0)).hour(number(9)).weekday(number(WeekDay.mon)),
  ),
  handler: () => notifyTeam(),
});
```

### Release the process with `unref()`

`unref()` lets Bun exit even while the cron timer remains scheduled.

```typescript
const heartbeat = new Cron({
  name: "heartbeat",
  schedule: "@minutely",
  handler: () => ping(),
});

heartbeat.run();
heartbeat.unref();
```

### Keep the process alive with `ref()`

After `unref()`, `ref()` makes the running timer keep the process alive again.

```typescript
heartbeat.ref();
```

### Inspect status with `getStatus()`

Status changes from `idle` to `running` after `run()`, then back to `idle` after `stop()`.

```typescript
heartbeat.getStatus(); // "running"
heartbeat.stop();
heartbeat.getStatus(); // "idle"
```

### Expand an alias with `getExpression()`

`getExpression()` returns the normalized five-field expression for aliases and returns explicit expressions unchanged.

```typescript
const daily = new Cron({
  name: "daily",
  schedule: "@daily",
  handler: () => {},
});

daily.getExpression(); // "0 0 * * *"
```

### Read the job name with `getJobName()`

`getJobName()` returns the name supplied to the constructor.

```typescript
daily.getJobName(); // "daily"
```

### Dispose an in-process job

Explicit resource management calls `stop()` through `Symbol.dispose` when the block ends.

```typescript
{
  using report = new Cron({
    name: "report",
    schedule: "@daily",
    handler: () => sendReport(),
  });

  report.run();
}
```

### Register an OS-level job with `CronOS.run()`

Unlike `Cron`, `CronOS` registers a script with the operating system and does not run an in-process handler.

```typescript
const backup = new CronOS({
  name: "nightly-backup",
  schedule: "@daily",
  path: "./scripts/backup.ts",
});

await backup.run();
```

### Remove an OS-level job with `CronOS.stop()`

`stop()` removes the named OS-level registration.

```typescript
await backup.stop();
```

### Inspect an OS-level job

`CronOS` shares `next()`, `getExpression()`, and `getJobName()` with in-process jobs; these inspect configuration without registering it.

```typescript
backup.next();
backup.getExpression(); // "0 0 * * *"
backup.getJobName(); // "nightly-backup"
```

## Reference

### `Cron` options

| Option | Meaning |
| --- | --- |
| `name` | Job name |
| `schedule` | Alias, cron string, or builder result |
| `handler` | Async or sync function |

### `Cron` methods

| Method | Meaning |
| --- | --- |
| `run()` | Start the schedule |
| `stop()` | Stop the schedule |
| `next(from?)` | Next fire time, or `null` if none |
| `ref()` / `unref()` | Keep / release the process |
| `getStatus()` / `getExpression()` / `getJobName()` | Inspect state |

Disposing a `Cron` with `Symbol.dispose` stops it.

### `CronOS` options

| Option | Meaning |
| --- | --- |
| `name` | Job name |
| `schedule` | Alias or cron string |
| `path` | Script path registered with Bun |

### `CronOS` methods

| Method | Meaning |
| --- | --- |
| `run()` | Register the script with OS-level cron |
| `stop()` | Remove the OS-level registration |
| `next(from?)` | Next fire time, or `null` if none |
| `getExpression()` / `getJobName()` | Inspect configuration |

### `CronDistributed` options

| Option | Meaning |
| --- | --- |
| `name` | Job name (also used in the Redis lock key) |
| `schedule` | Alias, cron string, or builder result |
| `handler` | Async or sync function |
| `redis` | Redis client used for tick locks |
| `replicaId?` | Value stored when this replica acquires the lock |
| `lockTTL?` | Lock expiry in ms (default `300000`) |

### `CronDistributed` methods

Same as `Cron`: `run()`, `stop()`, `next(from?)`, `ref()` / `unref()`, `getStatus()`, `getExpression()`, `getJobName()`. Disposing with `Symbol.dispose` stops the job.

### Errors

`EmptyListError`, `OutOfBoundError` (exported from `semola/cron`).
