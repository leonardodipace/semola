import assert from "node:assert";
import { mightThrow, mightThrowSync } from "../errors/index.js";
import { EnqueueError, SerializationError } from "./errors.js";
import { QueueRedisStore } from "./store.js";
import type { Job, JobState, QueueOptions } from "./types.js";

const toMinimalJob = <T>(jobState: JobState<T>): Job<T> => ({
  id: jobState.id,
  data: jobState.data,
  attempts: jobState.attempts,
  maxRetries: jobState.maxRetries,
  createdAt: jobState.createdAt,
});

const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_POLL_INTERVAL = 100;
const DEFAULT_RETRY_MAX_DELAY = 60000;
const DEFAULT_RETRY_BASE_DELAY = 1000;
const DEFAULT_RETRY_MULTIPLIER = 2;
const DEFAULT_VISIBILITY_MIN_MS = 60_000;
const DEFAULT_RECLAIM_BATCH_SIZE = 32;
const SHUTDOWN_POLL_INTERVAL = 10;

const resolveVisibilityTimeoutMs = (timeoutMs: number, explicit?: number) => {
  if (explicit !== undefined) {
    return explicit;
  }

  return Math.max(timeoutMs * 2, DEFAULT_VISIBILITY_MIN_MS);
};

export class Queue<T> {
  private options: QueueOptions<T>;
  private store: QueueRedisStore;
  private running = true;
  private activeWorkers = 0;
  private retries: number;
  private timeout: number;
  private concurrency: number;
  private pollInterval: number;
  private retryBaseDelay: number;
  private retryMultiplier: number;
  private retryMaxDelay: number;

  public constructor(options: QueueOptions<T>) {
    this.options = options;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
    this.retryBaseDelay =
      options.retryBackoff?.baseDelay ?? DEFAULT_RETRY_BASE_DELAY;
    this.retryMultiplier =
      options.retryBackoff?.multiplier ?? DEFAULT_RETRY_MULTIPLIER;
    this.retryMaxDelay =
      options.retryBackoff?.maxDelay ?? DEFAULT_RETRY_MAX_DELAY;

    assert.ok(
      Number.isFinite(this.retryBaseDelay) && this.retryBaseDelay > 0,
      "Invalid retryBackoff.baseDelay: must be a positive finite number",
    );
    assert.ok(
      Number.isFinite(this.retryMultiplier) && this.retryMultiplier > 0,
      "Invalid retryBackoff.multiplier: must be a positive finite number",
    );
    assert.ok(
      Number.isFinite(this.retryMaxDelay) && this.retryMaxDelay > 0,
      "Invalid retryBackoff.maxDelay: must be a positive finite number",
    );

    const visibilityTimeoutMs = resolveVisibilityTimeoutMs(
      this.timeout,
      options.visibilityTimeoutMs,
    );
    const reclaimBatchSize =
      options.reclaimBatchSize ?? DEFAULT_RECLAIM_BATCH_SIZE;

    this.store = new QueueRedisStore({
      redis: options.redis,
      queueName: options.name,
      visibilityTimeoutMs,
      reclaimBatchSize,
    });

    this.startWorkers();
  }

  private computeBackoffDelay(attempt: number) {
    return Math.min(
      this.retryBaseDelay * this.retryMultiplier ** (attempt - 1),
      this.retryMaxDelay,
    );
  }

  public async enqueue(data: T) {
    const job: JobState<T> = {
      id: crypto.randomUUID(),
      data,
      attempts: 0,
      maxRetries: this.retries,
      createdAt: Date.now(),
    };

    const [serializeError, serialized] = this.serializeJob(job);

    if (serializeError || !serialized) {
      throw new SerializationError("Unable to serialize job data");
    }

    const [enqueueError] = await this.store.enqueue(serialized);

    if (enqueueError) {
      throw new EnqueueError("Unable to enqueue job");
    }

    return job.id;
  }

  public async stop() {
    this.running = false;

    while (this.activeWorkers > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, SHUTDOWN_POLL_INTERVAL),
      );
    }
  }

  private waitForPollInterval() {
    return new Promise((resolve) => setTimeout(resolve, this.pollInterval));
  }

  private serializeJob(job: JobState<T>) {
    return mightThrowSync(() => JSON.stringify(job));
  }

  private async moveToDeadLetterQueue(jobData: string, parseError: Error) {
    const deadLetterEntry = JSON.stringify({
      jobData,
      parseError: this.formatErrorMessage(parseError),
      timestamp: Date.now(),
    });

    return this.store.pushDeadLetter(deadLetterEntry);
  }

  private formatErrorMessage(error: Error | null) {
    if (!error) return "Unknown error";

    return error.message;
  }

  private startWorkers() {
    for (let i = 0; i < this.concurrency; i++) {
      this.processJobs();
    }
  }

  private async processJobs() {
    while (this.running) {
      const [tickError] = await mightThrow(this.store.tick());

      if (tickError) {
        await this.waitForPollInterval();
        continue;
      }

      const [claimError, claimed] = await mightThrow(this.store.claim());

      if (claimError) {
        await this.waitForPollInterval();
        continue;
      }

      if (!claimed) {
        await this.waitForPollInterval();
        continue;
      }

      const jobData = claimed.serialized;

      const [parseError, job] = mightThrowSync<JobState<T>>(() =>
        JSON.parse(jobData),
      );

      if (parseError || !job) {
        await this.callOnErrorForParseFailure(jobData, parseError);
        await this.moveToDeadLetterQueue(jobData, parseError);
        await mightThrow(this.store.ack(jobData));
        await this.waitForPollInterval();
        continue;
      }

      if (!this.running) {
        await mightThrow(this.store.release(jobData));
        break;
      }

      this.activeWorkers++;

      await mightThrow(this.handleJob(job, jobData));
      this.activeWorkers--;
    }
  }

  private async handleJob(job: JobState<T>, serializedAtClaim: string) {
    const controller = new AbortController();

    const handlerPromise = Promise.resolve().then(() =>
      this.options.handler(job.data, controller.signal),
    );

    let timerId: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        reject(new Error(`Job timeout after ${this.timeout}ms`));
      }, this.timeout);
    });

    const [handlerError] = await mightThrow(
      Promise.race([handlerPromise.then(() => undefined), timeoutPromise]),
    );

    if (timerId) {
      clearTimeout(timerId);
    }

    if (handlerError && !controller.signal.aborted) {
      controller.abort();
    }

    if (!handlerError) {
      await mightThrow(this.store.ack(serializedAtClaim));

      if (this.options.onSuccess) {
        await mightThrow(
          Promise.resolve(this.options.onSuccess(toMinimalJob(job))),
        );
      }

      return;
    }

    job.attempts++;

    const errorMsg = this.formatErrorMessage(handlerError);
    job.error = errorMsg;

    if (!job.errorHistory) {
      job.errorHistory = [];
    }
    job.errorHistory.push({
      attempt: job.attempts,
      error: errorMsg,
      timestamp: Date.now(),
    });

    if (job.attempts <= job.maxRetries) {
      const delay = this.computeBackoffDelay(job.attempts);

      if (this.options.onRetry) {
        await mightThrow(
          Promise.resolve(
            this.options.onRetry({
              job: toMinimalJob(job),
              error: errorMsg,
              nextRetryDelayMs: delay,
              retriesRemaining: job.maxRetries - job.attempts,
              backoffMultiplier: this.retryMultiplier,
            }),
          ),
        );
      }

      const [stringifyError, updatedSerialized] = this.serializeJob(job);

      if (stringifyError || !updatedSerialized) {
        job.error = `Failed to serialize job for retry: ${this.formatErrorMessage(stringifyError)}`;
        await mightThrow(this.store.ack(serializedAtClaim));
        await this.callOnError(job);
        return;
      }

      const dueAtMs = Date.now() + delay;
      const [scheduleError] = await this.store.scheduleRetry(
        serializedAtClaim,
        updatedSerialized,
        dueAtMs,
      );

      if (scheduleError) {
        job.error = `Failed to schedule job retry: ${this.formatErrorMessage(scheduleError)}`;
        await mightThrow(this.store.ack(serializedAtClaim));
        await this.callOnError(job);
      }

      return;
    }

    await mightThrow(this.store.ack(serializedAtClaim));
    await this.callOnError(job);
  }

  private async callOnError(job: JobState<T>) {
    if (!this.options.onError) {
      return;
    }

    await mightThrow(
      Promise.resolve(
        this.options.onError({
          job: toMinimalJob(job),
          lastError: job.error ?? "",
          totalDurationMs: Date.now() - job.createdAt,
          totalAttempts: job.attempts,
          errorHistory: job.errorHistory ?? [],
        }),
      ),
    );
  }

  private async callOnErrorForParseFailure(jobData: string, parseError: Error) {
    if (!this.options.onParseError) {
      return;
    }

    await mightThrow(
      Promise.resolve(
        this.options.onParseError({
          rawJobData: jobData,
          parseError: this.formatErrorMessage(parseError),
          timestamp: Date.now(),
        }),
      ),
    );
  }
}
