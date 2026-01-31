# Queue

A Redis-backed job queue with automatic retry logic, exponential backoff, and concurrent processing.

## Import

```typescript
import { Queue } from "semola/queue";
```

## Basic Usage

```typescript
const queue = new Queue({
  name: "my-queue",
  redis: redisClient,
  handler: async (data) => {
    console.log(`Processing: ${data.message}`);
  },
});

// Add a job
const [error, jobId] = await queue.enqueue({ message: "Hello!" });

// Graceful shutdown
await queue.stop();
```

## Options

- **`name`** (required) - Queue name for Redis keys
- **`redis`** (required) - Bun Redis client instance
- **`handler`** (required) - Function to process each job
- **`retries`** - Number of retry attempts (default: 3)
- **`timeout`** - Job timeout in milliseconds (default: 30000)
- **`concurrency`** - Number of parallel workers (default: 1)
- **`onSuccess`** - Called when a job succeeds
- **`onRetry`** - Called when a job is retried
- **`onError`** - Called when a job fails permanently

## Examples

### With Error Handling

```typescript
const taskQueue = new Queue({
  name: "tasks",
  redis: new Bun.RedisClient("redis://localhost:6379"),
  handler: async (data) => {
    await processTask(data.taskId, data.userId);
  },
  onSuccess: (job) => {
    console.log(`✓ Task completed: ${job.id}`);
  },
  onRetry: (context) => {
    console.log(`⟳ Retrying ${context.job.id} in ${context.nextRetryDelayMs}ms (${context.retriesRemaining} left)`);
  },
  onError: (context) => {
    console.error(`✗ Task failed: ${context.job.id} after ${context.totalAttempts} attempts`);
    notifyFailure(context.job.data, context.lastError);
  },
  retries: 3,
  timeout: 60000,
  concurrency: 5,
});

// Add a job
const [error, jobId] = await taskQueue.enqueue({
  taskId: "task-123",
  userId: "user-456",
});

if (error) {
  console.error("Failed to enqueue:", error.message);
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  await taskQueue.stop();
});
```

### Email Queue

```typescript
const emailQueue = new Queue({
  name: "emails",
  redis: redisClient,
  handler: async (data) => {
    await sendEmail(data.to, data.subject, data.body);
  },
  retries: 5,
  timeout: 30000,
});

await emailQueue.enqueue({
  to: "user@example.com",
  subject: "Welcome!",
  body: "Thanks for signing up.",
});
```

### File Processing with Concurrency

```typescript
const importQueue = new Queue({
  name: "imports",
  redis: redisClient,
  handler: async (data) => {
    const file = await downloadFile(data.url);
    await importFileData(data.fileId, file);
  },
  onError: (context) => {
    logger.error(`Import failed: ${context.job.data.fileId}`);
  },
  retries: 2,
  timeout: 120000,
  concurrency: 3, // Process 3 files in parallel
});
```
