import { mightThrow } from "../errors/index.js";
import { queueKey } from "./keys.js";
import {
  CLAIM_JOB,
  MOVE_DUE_ZSET_TO_JOBS,
  RELEASE_JOB,
  SCHEDULE_RETRY,
} from "./scripts.js";
import type { ClaimedJob } from "./types.js";

export type QueueStoreOptions = {
  redis: Bun.RedisClient;
  queueName: string;
  visibilityTimeoutMs: number;
  reclaimBatchSize: number;
};

export class QueueRedisStore {
  private jobsKey: string;
  private inflightKey: string;
  private retryKey: string;
  private deadLetterKey: string;

  public constructor(private options: QueueStoreOptions) {
    this.jobsKey = queueKey(options.queueName, "jobs");
    this.inflightKey = queueKey(options.queueName, "inflight");
    this.retryKey = queueKey(options.queueName, "retry");
    this.deadLetterKey = queueKey(options.queueName, "dead-letter");
  }

  private evalScript(
    script: string,
    numKeys: number,
    keys: string[],
    argv: string[],
  ) {
    return mightThrow(
      this.options.redis.send("EVAL", [
        script,
        String(numKeys),
        ...keys,
        ...argv,
      ]),
    );
  }

  public async tick() {
    const now = String(Date.now());
    const limit = String(this.options.reclaimBatchSize);

    const [promoteError] = await this.evalScript(
      MOVE_DUE_ZSET_TO_JOBS,
      2,
      [this.retryKey, this.jobsKey],
      [now, limit],
    );

    if (promoteError) {
      throw promoteError;
    }

    const [reclaimError] = await this.evalScript(
      MOVE_DUE_ZSET_TO_JOBS,
      2,
      [this.inflightKey, this.jobsKey],
      [now, limit],
    );

    if (reclaimError) {
      throw reclaimError;
    }
  }

  public async claim(): Promise<ClaimedJob | null> {
    const deadline = String(Date.now() + this.options.visibilityTimeoutMs);

    const [error, result] = await this.evalScript(
      CLAIM_JOB,
      2,
      [this.jobsKey, this.inflightKey],
      [deadline],
    );

    if (error) {
      throw error;
    }

    if (result === false || result === null) {
      return null;
    }

    return { serialized: String(result) };
  }

  public async enqueue(serialized: string) {
    return mightThrow(this.options.redis.lpush(this.jobsKey, serialized));
  }

  public async removeInflight(serialized: string) {
    return mightThrow(this.options.redis.zrem(this.inflightKey, serialized));
  }

  public async scheduleRetry(
    serializedAtClaim: string,
    updatedSerialized: string,
    dueAtMs: number,
  ) {
    return this.evalScript(
      SCHEDULE_RETRY,
      2,
      [this.inflightKey, this.retryKey],
      [serializedAtClaim, updatedSerialized, String(dueAtMs)],
    );
  }

  public async release(serialized: string) {
    return this.evalScript(
      RELEASE_JOB,
      2,
      [this.inflightKey, this.jobsKey],
      [serialized],
    );
  }

  public async pushDeadLetter(entry: string) {
    return mightThrow(this.options.redis.lpush(this.deadLetterKey, entry));
  }
}
