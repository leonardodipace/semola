---
title: Cron
description: In-process cron schedules on Node and Bun, plus OS-level cron on Bun
---

Schedule work either in-process or through the operating system. `Cron` runs a handler inside the current process on Node and Bun. `CronOS` registers a script with Bun's OS-level cron helper so it runs independently of the current process, and only works on Bun. `CronDistributed` runs an in-process handler like `Cron`, but uses Redis so only one replica executes each scheduled tick.

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

### Expressions

Five fields: `minute hour day month weekday`. Each field takes `*`, numbers, ranges (`1-5`), steps (`*/5`, `1-30/2`, `5/15`), and comma lists (`1,5,10`). Month and weekday also take names (`JAN`, `January`, `MON`, `Monday`, case-insensitive). Weekday `0` and `7` both mean Sunday. Seconds are not supported.

When both day and weekday are restricted (neither is `*`), the job runs when either matches, as in POSIX cron.

Schedules run in the process's local time zone. Through DST changes a fixed time of day (`30 2 * * *`) runs once: shifted forward when clocks skip it, on the first pass when clocks repeat it. A schedule that fires many times a day (`0 * * * *`) pauses for the repeated hour, and several matches inside a skipped hour all run shifted forward. Zones with 30-minute DST shifts (Lord Howe) are not covered.

An invalid expression throws a `TypeError` from `run()` and `next()`. An expression that never matches (`0 0 31 2 *`) throws from `run()`, and `next()` returns `null`.

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

`next()` returns the next fire time, or `null` if there is no match. A running job checks the clock every second, so it fires within a second after its boundary, including after the machine sleeps. `ref()` / `unref()` control whether the timer keeps the process alive. A handler that is still running when the next boundary passes is not started again: the next run is the first boundary after it finishes. If the handler throws or rejects, the error surfaces as an unhandled rejection, as with `Bun.cron`. Node and Bun exit on an unhandled rejection by default, so catch errors inside the handler or listen for `unhandledRejection`; with the process still alive the job keeps running. `getStatus()`, `getExpression()`, and `getJobName()` inspect the job. Disposing the instance (`Symbol.dispose`) calls `stop`.

## OS crontab

`CronOS` registers a job with Bun's OS cron helper. It needs a script `path`, plus `name` and `schedule` (no in-process handler). It needs Bun; the rest of this module runs on Node and Bun.

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

In a multi-replica deployment, plain `Cron` runs the handler on every replica. `CronDistributed` wraps the same in-process schedule with a Redis lock keyed by job name, resolved expression, and tick, so only one replica runs each fire time.

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

Use `replicaId` to identify the lock owner in Redis (defaults to a random UUID per instance). `lockTTL` (default five minutes) bounds how long the deduplication lock is held. The lock is acquired before `handler()` runs and is not renewed while the handler executes, so deduplication is at-most-once only while that Redis key remains valid. If a replica is delayed past `lockTTL`, another replica can acquire the same tick key and run the handler again. Lock keys use the resolved cron expression and scheduled tick time so replicas coordinate on the same key when they fire within about a minute of the boundary. Handlers should be idempotent.

Use a unique `name` per job.

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

`CronDistributed` shares `run()`, `stop()`, `next()`, `ref()`, `unref()`, `getStatus()`, `getExpression()`, and `getJobName()` with `Cron`. Disposing the instance calls `stop()`. If the scheduled tick cannot be resolved within about a minute of the boundary, the handler is skipped.

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

`next()` returns its next matching `Date`, or `null` if there is no match (for example an impossible date). Pass a date or timestamp to calculate from another starting point.

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

`unref()` lets the process exit even while the cron timer remains scheduled.

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
| `name` | Job name (part of the Redis lock key) |
| `schedule` | Alias, cron string, or builder result |
| `handler` | Async or sync function |
| `redis` | Redis client used for tick locks: `Bun.RedisClient` or a [`semola/redis`](/docs/redis) adapter |
| `replicaId?` | Value stored when this replica acquires the lock |
| `lockTTL?` | Lock expiry in ms (default `300000`) |

### `CronDistributed` methods

Same as `Cron`: `run()`, `stop()`, `next(from?)`, `ref()` / `unref()`, `getStatus()`, `getExpression()`, `getJobName()`. Disposing with `Symbol.dispose` stops the job.

### Errors

`EmptyListError`, `OutOfBoundError` (exported from `semola/cron`). Invalid schedules throw a plain `TypeError`.
