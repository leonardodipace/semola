# Queue

A Redis-backed job queue with automatic retry logic, exponential backoff, and result-based error handling. Built on Bun's native Redis client.

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

**`queue.stop()`**

Gracefully stops the queue processor. No new jobs will be processed after this call.

```typescript
queue.stop();
```

## Features

### Automatic Processing

Jobs are automatically processed as soon as they're enqueued. The queue runs a background worker loop that continuously pulls jobs from Redis and executes the handler.

### Exponential Backoff

Failed jobs are automatically retried with exponential backoff. The delay follows the formula: `Math.min(1000 * 2^attempts, 60000)` milliseconds.

- 1st retry: 1000ms
- 2nd retry: 2000ms
- 3rd retry: 4000ms
- Max delay: 60000ms (1 minute)

### Error Handling

All methods return result tuples `[error, data]` for consistent error handling:

- `error` is `null` on success, containing `{ type, message }` on failure
- `data` contains the result on success, `null` on failure

### Callbacks

- **`handler`**: Required. Called when a job is ready for processing. Errors thrown here trigger retries.
- **`onSuccess`**: Optional. Called when a job succeeds after handler completion.
- **`onError`**: Optional. Called when a job is exhausted all retries.

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
  handler: async (data) => {
    // Process the task
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
process.on("SIGTERM", () => {
  taskQueue.stop();
});
```

## Error Types

The queue returns `QueueError` type errors:

- `QueueError` - Failed to enqueue job (Redis or serialization issues)
