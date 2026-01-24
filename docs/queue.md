# Queue

A Redis-backed job queue with automatic retry logic, exponential backoff, job timeouts, and concurrent processing. Built on Bun's native Redis client.

## Import

```typescript
import { Queue } from "semola/queue";
```

## API

**`new Queue<T>(options: QueueOptions<T>)`**

Creates a new queue instance that automatically starts processing jobs.

```typescript
type QueueOptions<T> = {
  name: string;
  redis: Bun.RedisClient;
  retries: number;
  handler: (data: T) => void | Promise<void>;
  onSuccess?: (job: Job<T>) => void | Promise<void>;
  onError?: (job: Job<T>) => void | Promise<void>;
  timeout?: number;
  concurrency?: number;
  pollInterval?: number;
};

type Job<T> = {
  id: string;
  data: T;
  attempts: number;
  maxRetries: number;
  createdAt: number;
  error?: string;
};

const queue = new Queue<{ message: string }>({
  name: "my-queue",
  redis: redisClient,
  retries: 3,
  handler: async (data) => {
    console.log(`Processing: ${data.message}`);
  },
  onSuccess: (job) => {
    console.log(`Job ${job.id} succeeded`);
  },
  onError: (job) => {
    console.error(`Job ${job.id} failed after retries:`, job.error);
  },
  timeout: 30000,
  concurrency: 1,
  pollInterval: 100,
});
```

**`queue.enqueue(data: T)`**

Enqueues a new job for processing. Returns a result tuple with the job ID or an error.

```typescript
const [error, jobId] = await queue.enqueue({ message: "Hello, world!" });

if (error) {
  console.error("Failed to enqueue:", error.message);
} else {
  console.log("Job enqueued:", jobId);
}
```

**`await queue.stop()`**

Gracefully stops the queue processor. Waits for all in-flight jobs to complete before fully stopping. No new jobs will be processed after this call.

```typescript
await queue.stop();
```

## Features

### Automatic Processing

Jobs are automatically processed as soon as they're enqueued. Multiple concurrent workers can process jobs in parallel based on the `concurrency` setting.

### Exponential Backoff

Failed jobs are automatically retried with exponential backoff. The delay follows the formula: `Math.min(1000 * 2^(attempt-1), 60000)` milliseconds, where attempt is 1-indexed.

- 1st attempt: immediate
- 1st retry (attempts=1): 1000ms
- 2nd retry (attempts=2): 2000ms
- 3rd retry (attempts=3): 4000ms
- Max delay: 60000ms (1 minute)

Jobs get exactly `retries + 1` total attempts (initial + retries).

### Job Timeout

Jobs that exceed the `timeout` duration are treated as failures and will be retried. Default timeout is 30 seconds. Set to a higher value for long-running operations.

### Concurrent Processing

Multiple jobs can be processed simultaneously using the `concurrency` option. Default is 1 (sequential). Increase concurrency for higher throughput on I/O-bound operations.

### Graceful Shutdown

Calling `await queue.stop()` gracefully shuts down the queue:

- No new jobs will be accepted from the queue
- In-flight jobs are allowed to complete
- The promise resolves once all workers have finished

### Error Handling

All methods return result tuples `[error, data]` for consistent error handling:

- `error` is `null` on success, containing `{ type, message }` on failure
- `data` contains the result on success, `null` on failure

### Callbacks

- **`handler`**: Required. Called when a job is ready for processing. Errors thrown here trigger retries.
- **`onSuccess`**: Optional. Called when a job succeeds after handler completion.
- **`onError`**: Optional. Called when a job has exhausted all retries.

## Configuration Options

### `retries`

Type: `number` (required)

Number of times to retry a failed job. Total attempts = `retries + 1`.

### `timeout`

Type: `number` (optional, default: `30000`)

Maximum time in milliseconds for a job handler to complete. Jobs exceeding this timeout are treated as failures and retried.

### `concurrency`

Type: `number` (optional, default: `1`)

Number of jobs to process concurrently. Set higher for parallel processing, but be mindful of Redis connections and handler resource usage.

### `pollInterval`

Type: `number` (optional, default: `100`)

Time in milliseconds between polling Redis for new jobs. Lower values reduce latency but increase Redis load.

## Example

```typescript
import { Queue } from "semola/queue";

type TaskData = {
  taskId: string;
  userId: string;
};

const taskQueue = new Queue<TaskData>({
  name: "tasks",
  redis: new Bun.RedisClient("redis://localhost:6379"),
  retries: 3,
  timeout: 60000,
  concurrency: 5,
  handler: async (data) => {
    // Process the task with timeout protection
    const result = await processTask(data.taskId, data.userId);
    console.log("Task processed:", result);
  },
  onSuccess: (job) => {
    console.log(`✓ Task completed: ${job.id}`);
  },
  onError: (job) => {
    console.log(`✗ Task failed: ${job.id}`);
    // Send notification, log to monitoring, etc.
    notifyFailure(job.data, job.error);
  },
});

// Enqueue a job
const [error, jobId] = await taskQueue.enqueue({
  taskId: "task-123",
  userId: "user-456",
});

if (!error) {
  console.log("Task queued:", jobId);
}

// Gracefully stop when shutting down
process.on("SIGTERM", async () => {
  console.log("Shutting down queue...");
  await taskQueue.stop();
});
```

## Advanced Example: Concurrent Processing with Timeout

```typescript
const importQueue = new Queue<{ fileId: string; url: string }>({
  name: "imports",
  redis,
  retries: 2,
  timeout: 120000, // 2 minute timeout for downloads
  concurrency: 3, // Process 3 imports in parallel
  handler: async (data) => {
    // Download and process file
    const file = await downloadFile(data.url);
    await importFileData(data.fileId, file);
  },
  onError: (job) => {
    logger.error(`Import failed for ${job.data.fileId}: ${job.error}`);
  },
});
```

## Error Types

The queue returns `QueueError` type errors:

- **`QueueError`** - Failed to enqueue job (Redis or serialization issues).

## Implementation Notes

- Job data is serialized to JSON for Redis storage. Ensure your data is JSON-serializable.
- Jobs in Redis survive process restarts, but in-flight jobs are lost if the process crashes mid-handler.
- The queue is designed for fire-and-forget task processing. For request-response patterns, use direct function calls.
