# Cron

A lightweight cron scheduler for executing periodic tasks. Supports standard cron expressions, convenient aliases, an expression builder, and second-level precision.

## Import

```typescript
import { Cron } from "semola/cron";
```

## Basic Usage

```typescript
const job = new Cron({
  name: "daily-cleanup",
  schedule: "0 0 * * *",
  handler: async () => {
    await cleanupOldRecords();
  },
});

job.start();

// Later...
job.stop();
```

## Options

- **`name`** (required) - Unique job name
- **`schedule`** (required) - Cron expression or alias
- **`handler`** (required) - Function to execute on schedule

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

### With Seconds (6 fields)

Six fields: second, minute, hour, day of month, month, day of week

```typescript
"* * * * * *"     // Every second
"*/5 * * * * *"   // Every 5 seconds
"30 * * * * *"    // Every 30th second of each minute
"0 */5 * * * *"   // Every 5 minutes
```

### Convenient Aliases

```typescript
"@yearly"    // 0 0 1 1 *
"@monthly"   // 0 0 1 * *
"@weekly"    // 0 0 * * 0
"@daily"     // 0 0 * * *
"@hourly"    // 0 * * * *
"@minutely"  // * * * * *
```

### Advanced Patterns

```typescript
"*/5 * * * *"      // Every 5 minutes
"0 9-17 * * *"     // Every hour from 9 AM to 5 PM
"0 0,12 * * *"     // At midnight and noon
"0 9-17/2 * * *"   // Every 2 hours from 9 AM to 5 PM
"*/30 * * * * *"   // Every 30 seconds
```

## Job Control

```typescript
const job = new Cron({...});

// Start scheduling
job.start();

// Pause (preserves state)
job.pause();

// Resume from pause
job.resume();

// Stop completely
job.stop();

// Check status: "idle" | "running" | "paused"
const status = job.getStatus();
```

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
    .second(range({ min: 10, max: 50 }))
    .minute(any())
    .hour(number(10))
    .day(number(1))
    .month(step({ step: Month.jul }))
    .weekday(list((l) => l.number(WeekDay.mon).number(WeekDay.wed))),
);

console.log(expr);
// Output: 10-50 * 10 1 */7 1,3
```

**Note:** If a field is not defined, it defaults to `'*'` (any).

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

reports.start();
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

cleanup.start();
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

healthCheck.start();
```

### High-Frequency Task (Every 5 seconds)

```typescript
const monitor = new Cron({
  name: "metrics-monitor",
  schedule: "*/5 * * * * *",
  handler: async () => {
    const metrics = await collectMetrics();
    await sendToMonitoring(metrics);
  },
});

monitor.start();
```

### Graceful Shutdown

```typescript
const job = new Cron({...});
job.start();

process.on("SIGTERM", async () => {
  console.log("Shutting down cron job...");
  job.stop();
  process.exit(0);
});
```

## Error Handling

If the handler throws an error, the job continues to the next scheduled execution. Handle errors in your handler.

```typescript
import { mightThrow } from "semola/errors";

const job = new Cron({
  name: "fragile-task",
  schedule: "0 * * * *",
  handler: async () => {
    const [error] = await mightThrow(riskyOperation());

    if (error) {
      // Handle error here - execution continues to next schedule
      console.error("Task failed:", error);
      await sendAlert(error);
    }
  },
});
```

## Concurrency

By default, only one instance of a job runs at a time. If a job is still running when the next schedule hits, the new execution is skipped.
