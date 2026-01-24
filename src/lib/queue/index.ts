import { err, mightThrow, mightThrowSync, ok } from "../errors/index.js";
import type { Job, QueueOptions } from "./types.js";

const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_POLL_INTERVAL = 100;
const MAX_BACKOFF_DELAY = 60000;
const BASE_BACKOFF_DELAY = 1000;
const BACKOFF_MULTIPLIER = 2;
const SHUTDOWN_POLL_INTERVAL = 10;

export class Queue<T> {
  private options: QueueOptions<T>;
  private running = true;
  private activeWorkers = 0;

  public constructor(options: QueueOptions<T>) {
    this.options = options;
    this.startWorkers();
  }

  public async enqueue(data: T) {
    const job: Job<T> = {
      id: crypto.randomUUID(),
      data,
      attempts: 0,
      maxRetries: this.options.retries ?? DEFAULT_RETRIES,
      createdAt: Date.now(),
    };

    const [stringifyError, serialized] = mightThrowSync(() =>
      JSON.stringify(job),
    );

    if (stringifyError) {
      return err("QueueError", "Unable to serialize job data");
    }

    if (!serialized) {
      return err("QueueError", "Unable to serialize job data");
    }

    const queueKey = `queue:${this.options.name}:jobs`;

    const [pushError] = await mightThrow(
      this.options.redis.lpush(queueKey, serialized),
    );

    if (pushError) {
      return err("QueueError", "Unable to enqueue job");
    }

    return ok(job.id);
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

  private startWorkers() {
    for (
      let i = 0;
      i < (this.options.concurrency ?? DEFAULT_CONCURRENCY);
      i++
    ) {
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
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            this.options.pollInterval ?? DEFAULT_POLL_INTERVAL,
          ),
        );
        continue;
      }

      if (!jobData) {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            this.options.pollInterval ?? DEFAULT_POLL_INTERVAL,
          ),
        );
        continue;
      }

      const [parseError, job] = mightThrowSync(
        () => JSON.parse(jobData) as Job<T>,
      );

      if (parseError || !job) {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            this.options.pollInterval ?? DEFAULT_POLL_INTERVAL,
          ),
        );
        continue;
      }

      // Skip processing if we've been stopped
      if (!this.running) {
        // Re-enqueue the job so it's not lost
        const [stringifyError, serialized] = mightThrowSync(() =>
          JSON.stringify(job),
        );

        if (!stringifyError && serialized) {
          await mightThrow(this.options.redis.lpush(queueKey, serialized));
        }

        break;
      }

      this.activeWorkers++;

      try {
        await this.handleJob(job);
      } finally {
        this.activeWorkers--;
      }
    }
  }

  private async handleJob(job: Job<T>) {
    const controller = new AbortController();

    const handlerPromise = Promise.resolve().then(() =>
      this.options.handler(job.data, controller.signal),
    );

    const timeout = this.options.timeout ?? DEFAULT_TIMEOUT;

    let timerId: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<Error>((resolve) => {
      timerId = setTimeout(() => {
        resolve(new Error(`Job timeout after ${timeout}ms`));
      }, timeout);
    });

    const [handlerError] = await mightThrow(
      Promise.race([
        handlerPromise.then(() => undefined),
        timeoutPromise.then((err) => {
          throw err;
        }),
      ]),
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
        await mightThrow(Promise.resolve(this.options.onSuccess(job)));
      }

      return;
    }

    job.attempts++;

    job.error =
      handlerError instanceof Error
        ? handlerError.message
        : String(handlerError);

    // Check if we should retry. Attempt starts at 1, so we retry while attempts <= maxRetries
    if (job.attempts <= (this.options.retries ?? DEFAULT_RETRIES)) {
      await this.retryJob(job);
    } else {
      if (this.options.onError) {
        await mightThrow(Promise.resolve(this.options.onError(job)));
      }
    }
  }

  private async retryJob(job: Job<T>) {
    // Exponential backoff: 1st retry (attempts=1) -> 1000ms, 2nd (attempts=2) -> 2000ms, etc.
    const delay = Math.min(
      BASE_BACKOFF_DELAY * BACKOFF_MULTIPLIER ** (job.attempts - 1),
      MAX_BACKOFF_DELAY,
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    const [stringifyError, serialized] = mightThrowSync(() =>
      JSON.stringify(job),
    );

    if (stringifyError) {
      job.error = `Failed to serialize job for retry: ${
        stringifyError instanceof Error
          ? stringifyError.message
          : String(stringifyError)
      }`;
      if (this.options.onError) {
        await mightThrow(Promise.resolve(this.options.onError(job)));
      }
      return;
    }

    if (!serialized) {
      job.error = "Failed to serialize job for retry";
      if (this.options.onError) {
        await mightThrow(Promise.resolve(this.options.onError(job)));
      }
      return;
    }

    const queueKey = `queue:${this.options.name}:jobs`;

    const [pushError] = await mightThrow(
      this.options.redis.lpush(queueKey, serialized),
    );

    if (pushError) {
      job.error = `Failed to re-enqueue job for retry: ${
        pushError instanceof Error ? pushError.message : String(pushError)
      }`;
      if (this.options.onError) {
        await mightThrow(Promise.resolve(this.options.onError(job)));
      }
    }
  }
}
