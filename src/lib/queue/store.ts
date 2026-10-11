import { mightThrow, mightThrowSync } from "../errors/index.js";
import type { JobState } from "./types.js";

const CLAIM_FROM_JOBS =
  "local p=redis.call('RPOP',KEYS[1]) if not p then return false end redis.call('ZADD',KEYS[2],tonumber(ARGV[1]),p) return p";

const CLAIM_DUE_RETRY =
  "local d=redis.call('ZRANGEBYSCORE',KEYS[1],0,tonumber(ARGV[1]),'LIMIT',0,1) if #d==0 then return false end local p=d[1] redis.call('ZREM',KEYS[1],p) redis.call('ZADD',KEYS[2],tonumber(ARGV[2]),p) return p";

const ACK =
  "local s=redis.call('ZSCORE',KEYS[1],ARGV[1]) if not s then return 0 end if tonumber(s)~=tonumber(ARGV[2]) then return 0 end return redis.call('ZREM',KEYS[1],ARGV[1])";

const RECLAIM_ONE =
  "local d=redis.call('ZRANGEBYSCORE',KEYS[1],0,tonumber(ARGV[1]),'LIMIT',0,1) if #d==0 then return false end local p=d[1] redis.call('ZREM',KEYS[1],p) redis.call('LPUSH',KEYS[2],p) return p";

const SCHEDULE_RETRY =
  "local s=redis.call('ZSCORE',KEYS[1],ARGV[1]) if not s then return 0 end if tonumber(s)~=tonumber(ARGV[4]) then return 0 end redis.call('ZREM',KEYS[1],ARGV[1]) redis.call('ZADD',KEYS[2],tonumber(ARGV[3]),ARGV[2]) return 1";

const RELEASE =
  "local s=redis.call('ZSCORE',KEYS[1],ARGV[1]) if not s then return 0 end if tonumber(s)~=tonumber(ARGV[2]) then return 0 end redis.call('ZREM',KEYS[1],ARGV[1]) redis.call('LPUSH',KEYS[2],ARGV[1]) return 1";

export class QueueStore {
  public constructor(
    private redis: Bun.RedisClient,
    private name: string,
    private visibilityTimeoutMs: number,
  ) {}

  private keys() {
    const n = this.name;

    return {
      jobs: `queue:${n}:jobs`,
      inflight: `queue:${n}:inflight`,
      retry: `queue:${n}:retry`,
      deadLetter: `queue:${n}:dead-letter`,
    };
  }

  private eval(script: string, keys: string[], argv: string[]) {
    return mightThrow(
      this.redis.send("EVAL", [script, String(keys.length), ...keys, ...argv]),
    );
  }

  public async enqueue(serialized: string) {
    const { jobs } = this.keys();

    return mightThrow(this.redis.lpush(jobs, serialized));
  }

  public async claimNext<T>() {
    const k = this.keys();
    const now = Date.now();
    const visibleUntil = now + this.visibilityTimeoutMs;

    const [retryError, retryPayload] = await this.eval(
      CLAIM_DUE_RETRY,
      [k.retry, k.inflight],
      [String(now), String(visibleUntil)],
    );

    if (retryError) {
      return { kind: "error" as const, error: retryError };
    }

    let raw = typeof retryPayload === "string" ? retryPayload : null;

    if (!raw) {
      const [jobsError, jobsPayload] = await this.eval(
        CLAIM_FROM_JOBS,
        [k.jobs, k.inflight],
        [String(visibleUntil)],
      );

      if (jobsError) {
        return { kind: "error" as const, error: jobsError };
      }

      raw = typeof jobsPayload === "string" ? jobsPayload : null;
    }

    if (!raw) {
      return { kind: "idle" as const };
    }

    const [parseError, job] = mightThrowSync<JobState<T>>(() =>
      JSON.parse(raw),
    );

    if (parseError || !job) {
      return { kind: "malformed" as const, raw, visibleUntil };
    }

    return { kind: "claimed" as const, raw, job, visibleUntil };
  }

  public async ack(raw: string, visibleUntil: number) {
    const { inflight } = this.keys();
    const [error] = await this.eval(
      ACK,
      [inflight],
      [raw, String(visibleUntil)],
    );

    return error;
  }

  public async release(raw: string, visibleUntil: number) {
    const k = this.keys();
    const [error] = await this.eval(
      RELEASE,
      [k.inflight, k.jobs],
      [raw, String(visibleUntil)],
    );

    return error;
  }

  public async scheduleRetry(
    oldRaw: string,
    nextRaw: string,
    runAtMs: number,
    visibleUntil: number,
  ) {
    const k = this.keys();
    const [error] = await this.eval(
      SCHEDULE_RETRY,
      [k.inflight, k.retry],
      [oldRaw, nextRaw, String(runAtMs), String(visibleUntil)],
    );

    return error;
  }

  public async reclaimOne() {
    const k = this.keys();
    const [error, result] = await this.eval(
      RECLAIM_ONE,
      [k.inflight, k.jobs],
      [String(Date.now())],
    );

    if (error) {
      return null;
    }

    if (typeof result !== "string") {
      return null;
    }

    return result;
  }

  public async pushDeadLetter(raw: string, parseError: string) {
    const { deadLetter } = this.keys();
    const [error] = await mightThrow(
      this.redis.lpush(
        deadLetter,
        JSON.stringify({
          jobData: raw,
          parseError,
          timestamp: Date.now(),
        }),
      ),
    );

    return error;
  }
}
