import assert from "node:assert";
import { mightThrow, mightThrowSync } from "../errors/index.js";
import { EnqueueError, SerializationError } from "./errors.js";
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
const SHUTDOWN_POLL_INTERVAL = 10;

export class Queue<T> {
  private options: QueueOptions<T>;
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

    const [enqueueError] = await this.enqueueJobData(serialized);

    if (enqueueError) {
      throw new EnqueueError("Unable to enqueue job");
    }

    return job.id;
  }

  public async stop() {
    this.running = false;

    // Wait for all active workers to finish processing
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

  private async enqueueJobData(serialized: string) {
    const queueKey = `queue:${this.options.name}:jobs`;
    return mightThrow(this.options.redis.lpush(queueKey, serialized));
  }

  private async moveToDeadLetterQueue(jobData: string, parseError: Error) {
    const deadLetterKey = `queue:${this.options.name}:dead-letter`;
    const deadLetterEntry = JSON.stringify({
      jobData,
      parseError: this.formatErrorMessage(parseError),
      timestamp: Date.now(),
    });

    return mightThrow(this.options.redis.lpush(deadLetterKey, deadLetterEntry));
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
      const queueKey = `queue:${this.options.name}:jobs`;

      const [popError, jobData] = await mightThrow(
        this.options.redis.rpop(queueKey),
      );

      if (popError) {
        await this.waitForPollInterval();
        continue;
      }

      if (!jobData) {
        await this.waitForPollInterval();
        continue;
      }

      const [parseError, job] = mightThrowSync<JobState<T>>(() =>
        JSON.parse(jobData),
      );

      if (parseError || !job) {
        // Handle malformed payload: preserve to dead-letter queue and notify
        await this.callOnErrorForParseFailure(jobData, parseError);
        await this.moveToDeadLetterQueue(jobData, parseError);
        await this.waitForPollInterval();
        continue;
      }

      // Skip processing if we've been stopped
      if (!this.running) {
        // Re-enqueue the job so it's not lost
        const [stringifyError, serialized] = this.serializeJob(job);

        if (!stringifyError && serialized) {
          await mightThrow(this.options.redis.lpush(queueKey, serialized));
        }

        break;
      }

      this.activeWorkers++;

      await mightThrow(this.handleJob(job));
      this.activeWorkers--;
    }
  }

  private async handleJob(job: JobState<T>) {
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

    // Abort handler if timeout occurred
    if (handlerError && !controller.signal.aborted) {
      controller.abort();
    }

    if (!handlerError) {
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

    // Check if we should retry. Attempt starts at 1, so we retry while attempts <= maxRetries
    if (job.attempts <= job.maxRetries) {
      if (this.options.onRetry) {
        const delay = this.computeBackoffDelay(job.attempts);

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
      await this.retryJob(job);
    } else {
      await this.callOnError(job);
    }
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

  private async retryJob(job: JobState<T>) {
    const delay = this.computeBackoffDelay(job.attempts);

    await new Promise((resolve) => setTimeout(resolve, delay));

    const [stringifyError, serialized] = this.serializeJob(job);

    if (stringifyError || !serialized) {
      job.error = `Failed to serialize job for retry: ${this.formatErrorMessage(stringifyError)}`;
      await this.callOnError(job);
      return;
    }

    const queueKey = `queue:${this.options.name}:jobs`;
    const [pushError] = await mightThrow(
      this.options.redis.lpush(queueKey, serialized),
    );

    if (pushError) {
      job.error = `Failed to re-enqueue job for retry: ${this.formatErrorMessage(pushError)}`;
      await this.callOnError(job);
    }
  }
}
