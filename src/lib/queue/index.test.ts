import { describe, expect, test } from "bun:test";
import { Queue } from "./index.js";
import type { ErrorContext, RetryContext } from "./types.js";

class MockRedisClient {
  private lists = new Map<string, string[]>();
  private shouldFail = false;

  public setShouldFail(value: boolean) {
    this.shouldFail = value;
  }

  public async lpush(key: string, value: string) {
    if (this.shouldFail) {
      throw new Error("Redis connection error");
    }

    if (!this.lists.has(key)) {
      this.lists.set(key, []);
    }

    this.lists.get(key)?.unshift(value);

    return this.lists.get(key)?.length ?? 0;
  }

  public async rpop(key: string) {
    if (this.shouldFail) {
      throw new Error("Redis connection error");
    }

    const list = this.lists.get(key);

    if (!list || list.length === 0) {
      return null;
    }

    return list.pop();
  }

  public clear() {
    this.lists.clear();
  }

  public getList(key: string) {
    return this.lists.get(key) ?? [];
  }
}

const createMockRedis = () => {
  return new MockRedisClient() as MockRedisClient & Bun.RedisClient;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Queue", () => {
  describe("enqueue", () => {
    test("should enqueue a job successfully", async () => {
      const redis = createMockRedis();
      const handler = () => {};
      const queue = new Queue({ name: "test", redis, retries: 3, handler });

      const [error, jobId] = await queue.enqueue({ message: "hello" });

      expect(error).toBeNull();
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe("string");

      await queue.stop();
    });

    test("should handle Redis connection errors", async () => {
      const redis = createMockRedis();
      const handler = () => {};
      const queue = new Queue({ name: "test", redis, retries: 3, handler });

      redis.setShouldFail(true);

      const [error, jobId] = await queue.enqueue({ message: "hello" });

      expect(error).toEqual({
        type: "QueueError",
        message: "Unable to enqueue job",
      });

      expect(jobId).toBeNull();

      await queue.stop();
    });

    test("should handle serialization errors", async () => {
      const redis = createMockRedis();
      const handler = () => {};
      const queue = new Queue({ name: "test", redis, retries: 3, handler });

      type CircularType = { a: number; self?: CircularType };

      const circular: CircularType = { a: 1 };

      circular.self = circular;

      const [error, jobId] = await queue.enqueue(circular);

      expect(error).toEqual({
        type: "QueueError",
        message: "Unable to serialize job data",
      });

      expect(jobId).toBeNull();

      await queue.stop();
    });
  });

  describe("processing", () => {
    test("should verify job is re-enqueued on failure", async () => {
      const redis = createMockRedis();
      let callCount = 0;

      const handler = () => {
        callCount++;

        if (callCount === 1) {
          throw new Error("First attempt fails");
        }
      };

      const queue = new Queue({ name: "test", redis, retries: 3, handler });

      await queue.enqueue({ message: "test" });

      await sleep(2500);

      expect(callCount).toBeGreaterThan(1);

      await queue.stop();
    });

    test("should process jobs in FIFO order", async () => {
      const redis = createMockRedis();
      const processed: string[] = [];

      const handler = (data: { message: string }) => {
        processed.push(data.message);
      };

      const queue = new Queue({ name: "test", redis, retries: 3, handler });

      await queue.enqueue({ message: "first" });
      await queue.enqueue({ message: "second" });
      await queue.enqueue({ message: "third" });

      await sleep(500);

      expect(processed).toEqual(["first", "second", "third"]);

      await queue.stop();
    });

    test("should call onSuccess callback on successful processing", async () => {
      const redis = createMockRedis();

      const handler = () => {};

      const successJobs: string[] = [];

      const onSuccess = (job: { id: string }) => {
        successJobs.push(job.id);
      };

      const queue = new Queue({
        name: "test",
        redis,
        retries: 3,
        handler,
        onSuccess,
      });

      const [, jobId] = await queue.enqueue({ message: "hello" });

      await sleep(200);

      expect(jobId).not.toBeNull();

      if (jobId) {
        expect(successJobs).toContain(jobId);
      }

      await queue.stop();
    });

    test("should call onRetry callback when job fails but will be retried", async () => {
      const redis = createMockRedis();
      let attempts = 0;

      const handler = () => {
        attempts++;
        if (attempts < 2) {
          throw new Error("First attempt fails");
        }
      };

      const retryContexts: Array<{
        id: string;
        attempts: number;
        error: string;
        nextRetryDelayMs: number;
        retriesRemaining: number;
      }> = [];

      const onRetry = (context: RetryContext<{ message: string }>) => {
        retryContexts.push({
          id: context.job.id,
          attempts: context.job.attempts,
          error: context.error,
          nextRetryDelayMs: context.nextRetryDelayMs,
          retriesRemaining: context.retriesRemaining,
        });
      };

      const queue = new Queue({
        name: "test",
        redis,
        retries: 2,
        handler,
        onRetry,
      });

      const [, jobId] = await queue.enqueue({ message: "hello" });

      await sleep(2500);

      expect(jobId).not.toBeNull();
      expect(retryContexts.length).toBe(1);

      if (jobId) {
        expect(retryContexts[0]?.id).toBe(jobId);
        expect(retryContexts[0]?.error).toBe("First attempt fails");
        expect(retryContexts[0]?.attempts).toBe(1);
        expect(retryContexts[0]?.nextRetryDelayMs).toBe(1000);
        expect(retryContexts[0]?.retriesRemaining).toBe(1);
      }

      await queue.stop();
    });

    test("should call onRetry multiple times for multiple failures", async () => {
      const redis = createMockRedis();
      let attempts = 0;

      const handler = () => {
        attempts++;
        throw new Error(`Attempt ${attempts} failed`);
      };

      const retryContexts: Array<{
        attempts: number;
        error: string;
        nextRetryDelayMs: number;
      }> = [];

      const onRetry = (context: RetryContext<{ message: string }>) => {
        retryContexts.push({
          attempts: context.job.attempts,
          error: context.error,
          nextRetryDelayMs: context.nextRetryDelayMs,
        });
      };

      const queue = new Queue({
        name: "test",
        redis,
        retries: 2,
        handler,
        onRetry,
      });

      await queue.enqueue({ message: "hello" });

      await sleep(4000);

      // Should have called onRetry 2 times (attempts 1, 2)
      expect(retryContexts.length).toBe(2);
      expect(retryContexts[0]?.attempts).toBe(1);
      expect(retryContexts[0]?.nextRetryDelayMs).toBe(1000);
      expect(retryContexts[1]?.attempts).toBe(2);
      expect(retryContexts[1]?.nextRetryDelayMs).toBe(2000);

      await queue.stop();
    });

    test("should not call onRetry when job succeeds on first try", async () => {
      const redis = createMockRedis();

      const handler = () => {};

      const retryJobs: string[] = [];

      const onRetry = (context: RetryContext<{ message: string }>) => {
        retryJobs.push(context.job.id);
      };

      const successJobs: string[] = [];

      const onSuccess = (job: { id: string }) => {
        successJobs.push(job.id);
      };

      const queue = new Queue({
        name: "test",
        redis,
        retries: 3,
        handler,
        onRetry,
        onSuccess,
      });

      const [, jobId] = await queue.enqueue({ message: "hello" });

      await sleep(200);

      expect(jobId).not.toBeNull();
      expect(retryJobs.length).toBe(0);

      if (jobId) {
        expect(successJobs).toContain(jobId);
      }

      await queue.stop();
    });

    test("should call onRetry then onError when retries exhausted", async () => {
      const redis = createMockRedis();

      const handler = () => {
        throw new Error("Always fails");
      };

      const retryJobs: string[] = [];
      const errorJobs: string[] = [];

      const onRetry = (context: RetryContext<{ message: string }>) => {
        retryJobs.push(context.job.id);
      };

      const onError = (context: ErrorContext<{ message: string }>) => {
        errorJobs.push(context.job.id);
      };

      const queue = new Queue({
        name: "test",
        redis,
        retries: 2,
        handler,
        onRetry,
        onError,
      });

      const [, jobId] = await queue.enqueue({ message: "hello" });

      await sleep(4000);

      expect(jobId).not.toBeNull();
      expect(retryJobs.length).toBe(2);
      expect(errorJobs.length).toBe(1);

      if (jobId) {
        expect(retryJobs).toContain(jobId);
        expect(errorJobs).toContain(jobId);
      }

      await queue.stop();
    });

    test("should retry failed jobs with exponential backoff", async () => {
      const redis = createMockRedis();

      let attempts = 0;

      const handler = () => {
        attempts++;

        if (attempts < 2) {
          throw new Error("Processing failed");
        }
      };

      const queue = new Queue({ name: "test", redis, retries: 2, handler });

      await queue.enqueue({ message: "hello" });

      await sleep(3000);

      expect(attempts).toBe(2);

      await queue.stop();
    });

    test("should respect maxRetries limit", async () => {
      const redis = createMockRedis();

      let attempts = 0;

      const handler = () => {
        attempts++;

        throw new Error("Always fails");
      };

      const errorJobs: string[] = [];

      const onError = (context: ErrorContext<{ message: string }>) => {
        errorJobs.push(context.job.id);
      };

      const queue = new Queue({
        name: "test",
        redis,
        retries: 2,
        handler,
        onError,
      });

      const [, jobId] = await queue.enqueue({ message: "hello" });

      await sleep(4000);

      expect(attempts).toBe(3);

      expect(jobId).not.toBeNull();

      if (jobId) {
        expect(errorJobs).toContain(jobId);
      }

      await queue.stop();
    });

    test("should call onError when retries are exhausted", async () => {
      const redis = createMockRedis();

      const handler = () => {
        throw new Error("Processing failed");
      };

      const errorContexts: Array<{
        id: string;
        lastError: string;
        totalDurationMs: number;
        totalAttempts: number;
        errorHistory: Array<{ attempt: number; error: string }>;
      }> = [];

      const onError = (context: ErrorContext<{ message: string }>) => {
        errorContexts.push({
          id: context.job.id,
          lastError: context.lastError,
          totalDurationMs: context.totalDurationMs,
          totalAttempts: context.totalAttempts,
          errorHistory: context.errorHistory,
        });
      };

      const queue = new Queue({
        name: "test",
        redis,
        retries: 1,
        handler,
        onError,
      });

      const [, jobId] = await queue.enqueue({ message: "hello" });

      await sleep(3000);

      expect(errorContexts.length).toBe(1);
      expect(jobId).not.toBeNull();

      if (jobId) {
        expect(errorContexts[0]?.id).toBe(jobId);
        expect(errorContexts[0]?.lastError).toBe("Processing failed");
        expect(errorContexts[0]?.totalAttempts).toBe(2);
        expect(errorContexts[0]?.totalDurationMs).toBeGreaterThan(0);
        expect(errorContexts[0]?.errorHistory).toBeDefined();
        expect(errorContexts[0]?.errorHistory.length).toBeGreaterThan(0);
      }

      await queue.stop();
    });

    test("should handle handler errors", async () => {
      const redis = createMockRedis();

      const handler = () => {
        throw new Error("Handler error");
      };

      const errorJobs: string[] = [];

      const onError = (context: ErrorContext<{ message: string }>) => {
        errorJobs.push(context.job.id);
      };

      const queue = new Queue({
        name: "test",
        redis,
        retries: 1,
        handler,
        onError,
      });

      const [, jobId] = await queue.enqueue({ message: "hello" });

      await sleep(3000);

      expect(jobId).not.toBeNull();

      if (jobId) {
        expect(errorJobs).toContain(jobId);
      }

      await queue.stop();
    });
  });

  describe("lifecycle", () => {
    test("should auto-start processing in constructor", async () => {
      const redis = createMockRedis();
      const processed: string[] = [];

      const handler = (data: { message: string }) => {
        processed.push(data.message);
      };

      const queue = new Queue({ name: "test", redis, retries: 3, handler });

      await queue.enqueue({ message: "hello" });

      await sleep(200);

      expect(processed).toContain("hello");

      await queue.stop();
    });

    test("should stop processing after stop() is called", async () => {
      const redis = createMockRedis();
      const processed: string[] = [];

      const handler = (data: { message: string }) => {
        processed.push(data.message);
      };

      const queue = new Queue({ name: "test", redis, retries: 3, handler });

      await queue.enqueue({ message: "first" });

      await sleep(200);

      await queue.stop();

      await queue.enqueue({ message: "second" });

      await sleep(200);

      expect(processed).toContain("first");
      expect(processed).not.toContain("second");
    });
  });

  describe("edge cases", () => {
    test("should handle empty queue gracefully", async () => {
      const redis = createMockRedis();
      const handler = () => {};

      const queue = new Queue({ name: "test", redis, retries: 3, handler });

      await sleep(200);

      await queue.stop();
    });

    test("should handle async handlers", async () => {
      const redis = createMockRedis();
      const processed: string[] = [];

      const handler = async (data: { message: string }) => {
        await sleep(10);
        processed.push(data.message);
      };

      const queue = new Queue({ name: "test", redis, retries: 3, handler });

      await queue.enqueue({ message: "async" });

      await sleep(200);

      expect(processed).toContain("async");

      await queue.stop();
    });

    test("should handle multiple queues with different names", async () => {
      const redis = createMockRedis();
      const processed1: string[] = [];
      const processed2: string[] = [];

      const handler1 = (data: { message: string }) => {
        processed1.push(data.message);
      };

      const handler2 = (data: { message: string }) => {
        processed2.push(data.message);
      };

      const queue1 = new Queue({
        name: "queue1",
        redis,
        retries: 3,
        handler: handler1,
      });

      const queue2 = new Queue({
        name: "queue2",
        redis,
        retries: 3,
        handler: handler2,
      });

      await queue1.enqueue({ message: "q1" });
      await queue2.enqueue({ message: "q2" });

      await sleep(200);

      expect(processed1).toContain("q1");
      expect(processed1).not.toContain("q2");
      expect(processed2).toContain("q2");
      expect(processed2).not.toContain("q1");

      await queue1.stop();
      await queue2.stop();
    });

    test("should handle deserialization errors gracefully", async () => {
      const redis = createMockRedis();
      const handler = () => {};

      const queue = new Queue({ name: "test", redis, retries: 3, handler });

      await redis.lpush("queue:test:jobs", "invalid json {");

      await sleep(200);

      await queue.stop();
    });

    test("should handle large job data", async () => {
      const redis = createMockRedis();
      const processed: any[] = [];

      const handler = (data: any) => {
        processed.push(data);
      };

      const queue = new Queue({ name: "test", redis, retries: 3, handler });

      const largeData = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
        })),
      };

      await queue.enqueue(largeData);

      await sleep(200);

      expect(processed[0]).toEqual(largeData);

      await queue.stop();
    });

    test("should handle job timeout", async () => {
      const redis = createMockRedis();
      let attempts = 0;
      const signalStates: boolean[] = [];

      const handler = async (_data: unknown, signal?: AbortSignal) => {
        attempts++;
        // Capture initial signal state
        signalStates.push(signal?.aborted ?? false);
        // Sleep longer than timeout
        await sleep(500);
        // Capture signal state after timeout should have fired
        signalStates.push(signal?.aborted ?? false);
      };

      const errorJobs: string[] = [];

      const onError = (context: ErrorContext<{ message: string }>) => {
        errorJobs.push(context.job.id);
      };

      const queue = new Queue({
        name: "test",
        redis,
        retries: 1,
        handler,
        timeout: 100,
        onError,
      });

      const [, jobId] = await queue.enqueue({ message: "hello" });

      await sleep(3000);

      // Should have retried once due to timeout
      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(jobId).not.toBeNull();

      if (jobId) {
        expect(errorJobs).toContain(jobId);
      }

      // Verify signal was received and got aborted after timeout
      expect(signalStates.length).toBeGreaterThan(0);
      expect(signalStates[0]).toBe(false); // Signal not aborted initially
      // At least one signal should be aborted after timeout fires
      expect(signalStates.some((state) => state === true)).toBe(true);

      await queue.stop();
    });

    test("should respect concurrency limits", async () => {
      const redis = createMockRedis();
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const handler = async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await sleep(50);
        currentConcurrent--;
      };

      const queue = new Queue({
        name: "test",
        redis,
        retries: 1,
        handler,
        concurrency: 2,
      });

      // Enqueue multiple jobs
      await queue.enqueue({ message: "1" });
      await queue.enqueue({ message: "2" });
      await queue.enqueue({ message: "3" });
      await queue.enqueue({ message: "4" });

      await sleep(500);

      // Should not exceed concurrency limit
      expect(maxConcurrent).toBeLessThanOrEqual(2);

      await queue.stop();
    });

    test("should handle graceful shutdown with pending jobs", async () => {
      const redis = createMockRedis();
      const processed: string[] = [];

      const handler = async (data: { message: string }) => {
        await sleep(50);
        processed.push(data.message);
      };

      const queue = new Queue({ name: "test", redis, retries: 1, handler });

      await queue.enqueue({ message: "job1" });
      await queue.enqueue({ message: "job2" });

      await sleep(100); // Give it time to start processing

      await queue.stop(); // Should wait for in-flight jobs

      // Should have completed at least job1
      expect(processed.length).toBeGreaterThan(0);
    });
  });
});
