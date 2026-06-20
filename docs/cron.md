# Cron

A lightweight cron scheduler for executing periodic tasks built on top of Bun's native cron module. Supports standard cron expressions, convenient aliases, retries, an expression builder and in-process and OS level jobs.

## Import

```typescript
import {
  Cron,
  CronOS,
  RetryCronJob,
  Month,
  WeekDay, 
  cronJobBuilder,
  any,
  number,
  range,
  step,
  list
} from "semola/cron"
```

## Basic Usage

```typescript
// Define an in-process job
const endpointCheckCron = new Cron({
  name: "endpoint-check",
  schedule: "@minutely",
  handler: async () => {
    await checkEndpoint();
  },
});

// Define an OS-level job
const osJob = new CronOS({
  name: "daily-report",
  schedule: "@daily",
  path: "./report-worker.ts",
});

endpointCheckCron.run();
await osJob.run();

// Later...

endpointCheckCron.stop();
await osJob.stop();
```

## Options

- `Cron` class:
  - **`name: string`** (required) - Unique job name
  - **`schedule: string`** (required) - Cron expression or alias
  - **`handler: () => unknown`** (required) - Function to execute on schedule. Support both sync and async functions
  - **`retry: RetryCronJob`** (optinal) - Instace of `RetryCronJob` class containing retries' handling logic
- `CronOS` class:
  - **`name`** (required) - Unique job name
  - **`schedule`** (required) - Cron expression or alias
  - **`path: string`** (required) - Script's path. Note that Bun resolves it relative to the caller.


## Schedule Formats

### Standard Cron Expression (5 fields)

Five fields: minute, hour, day of month, month, day of week

```typescript
"0 0 * * *"      // Daily at midnight
"0 */6 * * *"    // Every 6 hours
"30 9 * * 1-5"   // 9:30 AM on weekdays
"0 0 1 * *"      // First day of month
"0 0 * * 0"      // Every Sunday
```

### Convenient Aliases

```typescript
"@yearly", "@annually"    // 0 0 1 1 *
"@monthly"                // 0 0 1 * *
"@weekly"                 // 0 0 * * 0
"@daily", "@midnight"     // 0 0 * * *
"@hourly"                 // 0 * * * *
"@minutely"               // * * * * *
```

### Advanced Patterns

```typescript
"0 9 * * TUE-FRI"      
"0 0 1 JUN,JUL,AUG *" 

// or...

"0 9 * * TUESDAY-FRIDAY"      
"0 0 1 JUNE,JULY,AUGUST *"    
```

**Note**: Both `0` and `7` represent _"Sunday"_ in the weekday field.

## Job Control

```typescript
const job = new Cron({...});
const osJob = new CronOS({...});

// Start scheduling
job.run();
await osJob.run()

// Stop completely
job.stop();
await osJob.stop()

// Check status: "idle" | "running"
const status = job.getStatus();

job.ref()
job.unref();
```

**Note:** `ref()`, `unref()` and `getStatus()` methods are avaiable only for in-process job.

## Common Utilities

This is a list of methods avaiable for both `Cron` and `CronOS` classes:
- `getExpression(): string` - returns the job's expression 
- `getJobName(): string` - returns the job's name 
- `next(from?: Date | number): Date | null` - returns the next matching Date in UTC format or `null` if no match exists within 8 years. 
  - `from` - Starting point for the search. This paramenter can be a `Date` object or a date expressed in milliseconds

```typescript
const job = new Cron({
  name: "monthly-job",
  schedule: "@monthly",
  handler: async () => {
    await cleanDB();
  },
});

console.log(job.next());
console.log(job.next(new Date(1990, 1)));

// Output:
// 2026-07-01T00:00:00.000Z
// 1990-02-01T00:00:00.000Z
```

**Note**: the `next()` method will raise an error if the used expression is invalid or if it is `NaN` or `Infinity`. 

## Expression Builder

Build cron expressions programmatically with full type-safety supported by a fluent and an intuitive API.

```typescript
import { 
  any,
  cronJobBuilder,
  list,
  number,
  range,
  step,
  Month, 
  WeekDay
} from "semola/cron";

const expr = cronJobBuilder((builder) =>
  builder
    .minute(any())
    .hour(number(10))
    .day(number(1))
    .month(step({ step: Month.jul }))
    .weekday(list((l) => l.number(WeekDay.mon).number(WeekDay.wed))),
);

console.log(expr);
// Output: * 10 1 */7 1,3
```

**Note:** If a field is not defined, it defaults to `'*'` (any).

## Error Handling and Retries

Pass an optional `RetryCronJob` instance to automatically retry your in-process job for a fixed amount of time.

```typescript
const cleanup = new Cron({
  name: "endpoint-check",
  schedule: "@minutely",
  handler: async () => {
    await checkEndpoint();
  },
  retry: new RetryCronJob({
    maxAttempts: 2,
    onError: (ctx) => console.log(`An error: ${ctx.error.message}`),
    retryOnError: (err) => !(error instanceof MyCustomError),
    onFailedAttempt: async ({ attemptNumber, delay, error, retriesLeft }) => {
      console.log(
        `Attempt ${attemptNumber} failed. Retrying in ${delay}ms. ${retriesLeft} retries left.`,
      );

      await recover();
    },
  }),
});
```

- **`maxAttempts`** (required) - The maximum number of attempts
- **`onError(ctx: ErrorMetadataType): void | Promise<void>`** (optional) - Function called when an error is raised inside the `handler` function, after all retries have been exhausted, with the final error passed in as the argument. If not provided, the instance re-raises that error. The `ErrorMetadataType` type contains the following properties:
  - `name: string` - The job's name
  - `failedAt: number` - When the job failed, expressed in milliseconds
  - `error: Error` - Which error was fired
- **`retryOnError(error: Error): boolean`** (optional) - Function called before each attempt. This function return `true` if a job should consume the current retry, otherwise it must return `false`. By default, if not provided, a job will retry on every error raised by the `handler` function
- **`onFailedAttempt(ctx: OnFailedAttemptContextType): void | Promise<void>`** (optional) - Function called on every attempt. The `OnFailedAttemptContextType` type contains the following properties:
  - `error: Error` - Which error was fired in the `handler` function
  - `attemptNumber: number` - The attempt number. Note that they start at 1
  - `retriesLeft: number` - How many retries remains before stopping the job
  - `delay: number` - How much time the job will be paused before running again. The delay is calculated based on the exponential backoff algorithm with [Full Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) strategy.


## Examples

### Daily Report Generation

```typescript
const reports = new Cron({
  name: "daily-reports",
  schedule: "0 6 * * *",
  handler: async () => {
    const data = await fetchDailyMetrics();
    const report = await generateReport(data);
    await sendEmail("admin@company.com", "Daily Report", report);
  },
});

reports.run();
```

### Database Cleanup

```typescript
const cleanup = new Cron({
  name: "db-cleanup",
  schedule: "@daily",
  handler: async () => {
    await deleteOldLogs(30);
    await archiveInactiveUsers(90);
  },
});

cleanup.run();
```

### Retry generating a report

```typescript
const reports = new Cron({
  name: "daily-reports",
  schedule: "0 6 * * *",
  handler: async () => {
    const data = await fetchDailyMetrics();
    const report = await generateReport(data);
    await sendEmail("admin@company.com", "Daily Report", report);
  },
  retry: new RetryCronJob({
    maxAttempts: 10,
    onFailedAttempt: async ({ error, attemptNumber }) => {
      console.log(
        `Attempt number ${attemptNumber} for error: ${error.name} => ${error.message}`,
      );

      await retryEmail();
    },
  }),
});

reports.run();
```


### Health Check Every Minute

```typescript
const healthCheck = new Cron({
  name: "health-check",
  schedule: "@minutely",
  handler: async () => {
    const services = ["api", "database", "cache"];

    for (const service of services) {
      const status = await checkService(service);

      if (!status.healthy) {
        await alertTeam(`${service} is down`);
      }
    }
  },
});

healthCheck.run();
```

### Graceful Shutdown

```typescript
const job = new Cron({...});
job.run();

process.on("SIGTERM", async () => {
  console.log("Shutting down cron job...");
  job.stop();
  process.exit(0);
});
```

### Save OS Level Job Status

```typescript
// index.ts
const job = new CronOS({
  name: "monthly-job",
  schedule: "@monthly",
  path: "./worker.ts",
});

await job.run();


// worker.ts
const logger = new Logger("job-staus", [
  new FileProvider("./job-status.json", {
    formatter: new JSONFormatter(),
    policy: { type: "time", instant: "month", duration: 12 },
  }),
]);

export default {
  scheduled(controller: Bun.CronController) {
    logger.debug(controller);
  },
};
```
