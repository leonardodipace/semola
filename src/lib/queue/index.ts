import assert from "node:assert";
import { mightThrow, mightThrowSync } from "../errors/index.js";
import { EnqueueError, SerializationError } from "./errors.js";
import { QueueStore } from "./store.js";
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
const MIN_VISIBILITY_MS = 1000;

export class Queue<T> {
  private options: QueueOptions<T>;
  private store: QueueStore;
  private running = true;
  private activeWorkers = 0;
  private retries: number;
  private timeout: number;
  private concurrency: number;
  private pollInterval: number;
  private retryBaseDelay: number;
  private retryMultiplier: number;
  private retryMaxDelay: number;
  private visibilityTimeoutMs: number;
  private reclaimIntervalMs: number;

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
    this.visibilityTimeoutMs =
      options.visibilityTimeoutMs ?? Math.max(this.timeout * 2, 60_000);
    this.reclaimIntervalMs = Math.max(this.pollInterval, 200);

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
    assert.ok(
      Number.isFinite(this.visibilityTimeoutMs) &&
        this.visibilityTimeoutMs >= MIN_VISIBILITY_MS,
      "Invalid visibilityTimeoutMs: must be at least 1000",
    );

    this.store = new QueueStore(
      options.redis,
      options.name,
      this.visibilityTimeoutMs,
    );

    this.startWorkers();
    void this.reclaimLoop();
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

  private formatErrorMessage(error: Error | null) {
    if (!error) return "Unknown error";

    return error.message;
  }

  private startWorkers() {
    for (let i = 0; i < this.concurrency; i++) {
      void this.processJobs();
    }
  }

  private async reclaimLoop() {
    while (this.running) {
      while (this.running) {
        const raw = await this.store.reclaimOne();

        if (!raw) {
          break;
        }
      }

      if (!this.running) {
        break;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, this.reclaimIntervalMs),
      );
    }
  }

  private async processJobs() {
    while (this.running) {
      const claim = await this.store.claimNext<T>();

      if (claim.kind === "error") {
        await this.waitForPollInterval();
        continue;
      }

      if (claim.kind === "idle") {
        await this.waitForPollInterval();
        continue;
      }

      if (claim.kind === "malformed") {
        await this.callOnErrorForParseFailure(
          claim.raw,
          new Error("Invalid job JSON"),
        );
        await this.store.pushDeadLetter(claim.raw, "Invalid job JSON");
        await this.store.ack(claim.raw, claim.visibleUntil);
        await this.waitForPollInterval();
        continue;
      }

      if (!this.running) {
        await this.store.release(claim.raw, claim.visibleUntil);
        break;
      }

      this.activeWorkers++;

      await mightThrow(
        this.handleClaimed(claim.raw, claim.job, claim.visibleUntil),
      );

      this.activeWorkers--;
    }
  }

  private async handleClaimed(
    raw: string,
    job: JobState<T>,
    visibleUntil: number,
  ) {
    const controller = new AbortController();

    const handlerPromise = Promise.resolve().then(() =>
      this.options.handler(job.data, controller.signal),
    );

    let timerId: ReturnType<typeof setTimeout> | undefined;

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
      if (this.options.onSuccess) {
        await mightThrow(
          Promise.resolve(this.options.onSuccess(toMinimalJob(job))),
        );
      }

      await this.store.ack(raw, visibleUntil);
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

      await this.scheduleRetry(raw, job, visibleUntil);
      return;
    }

    await this.callOnError(job);
    await this.store.ack(raw, visibleUntil);
  }

  private async scheduleRetry(
    raw: string,
    job: JobState<T>,
    visibleUntil: number,
  ) {
    const delay = this.computeBackoffDelay(job.attempts);
    const runAtMs = Date.now() + delay;
    const [stringifyError, nextRaw] = this.serializeJob(job);

    if (stringifyError || !nextRaw) {
      job.error = `Failed to serialize job for retry: ${this.formatErrorMessage(stringifyError)}`;
      await this.callOnError(job);
      await this.store.ack(raw, visibleUntil);
      return;
    }

    const scheduleError = await this.store.scheduleRetry(
      raw,
      nextRaw,
      runAtMs,
      visibleUntil,
    );

    if (scheduleError) {
      job.error = `Failed to schedule job retry: ${this.formatErrorMessage(scheduleError)}`;
      await this.callOnError(job);
      await this.store.ack(raw, visibleUntil);
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
}
