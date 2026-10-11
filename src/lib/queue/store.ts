import { mightThrow, mightThrowSync } from "../errors/index.js";
import type { JobState } from "./types.js";

const CLAIM_FROM_JOBS =
  "local p=redis.call('RPOP',KEYS[1]) if not p then return false end redis.call('ZADD',KEYS[2],tonumber(ARGV[1]),p) return p";

const CLAIM_DUE_RETRY =
  "local d=redis.call('ZRANGEBYSCORE',KEYS[1],0,tonumber(ARGV[1]),'LIMIT',0,1) if #d==0 then return false end local p=d[1] redis.call('ZREM',KEYS[1],p) redis.call('ZADD',KEYS[2],tonumber(ARGV[2]),p) return p";

const ACK = "return redis.call('ZREM',KEYS[1],ARGV[1])";

const RECLAIM_ONE =
  "local d=redis.call('ZRANGEBYSCORE',KEYS[1],0,tonumber(ARGV[1]),'LIMIT',0,1) if #d==0 then return false end local p=d[1] redis.call('ZREM',KEYS[1],p) redis.call('LPUSH',KEYS[2],p) return p";

const SCHEDULE_RETRY =
  "redis.call('ZREM',KEYS[1],ARGV[1]) redis.call('ZADD',KEYS[2],tonumber(ARGV[3]),ARGV[2]) return 1";

const RELEASE =
  "local n=redis.call('ZREM',KEYS[1],ARGV[1]) if n==0 then return 0 end redis.call('LPUSH',KEYS[2],ARGV[1]) return 1";

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

  public async enqueue(serialized: string) {
    const { jobs } = this.keys();

    return mightThrow(this.redis.lpush(jobs, serialized));
  }

  public async claimNext<T>() {
    const k = this.keys();
    const now = Date.now();
    const visibleUntil = now + this.visibilityTimeoutMs;

    const [retryError, retryPayload] = await mightThrow(
      this.redis.send("EVAL", [
        CLAIM_DUE_RETRY,
        "2",
        k.retry,
        k.inflight,
        String(now),
        String(visibleUntil),
      ]),
    );

    if (retryError) {
      return { kind: "error" as const, error: retryError };
    }

    let raw = typeof retryPayload === "string" ? retryPayload : null;

    if (!raw) {
      const [jobsError, jobsPayload] = await mightThrow(
        this.redis.send("EVAL", [
          CLAIM_FROM_JOBS,
          "2",
          k.jobs,
          k.inflight,
          String(visibleUntil),
        ]),
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
      return { kind: "malformed" as const, raw };
    }

    return { kind: "claimed" as const, raw, job };
  }

  public async ack(raw: string) {
    const { inflight } = this.keys();

    const [error] = await mightThrow(
      this.redis.send("EVAL", [ACK, "1", inflight, raw]),
    );

    return error;
  }

  public async release(raw: string) {
    const k = this.keys();

    const [error] = await mightThrow(
      this.redis.send("EVAL", [RELEASE, "2", k.inflight, k.jobs, raw]),
    );

    return error;
  }

  public async scheduleRetry(oldRaw: string, nextRaw: string, runAtMs: number) {
    const k = this.keys();

    const [error] = await mightThrow(
      this.redis.send("EVAL", [
        SCHEDULE_RETRY,
        "2",
        k.inflight,
        k.retry,
        oldRaw,
        nextRaw,
        String(runAtMs),
      ]),
    );

    return error;
  }

  public async reclaimOne() {
    const k = this.keys();

    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        RECLAIM_ONE,
        "2",
        k.inflight,
        k.jobs,
        String(Date.now()),
      ]),
    );

    if (error) {
      return null;
    }

    if (typeof result === "string") {
      return result;
    }

    return null;
  }

  public async pushDeadLetter(raw: string, parseError: string) {
    const entry = JSON.stringify({
      jobData: raw,
      parseError,
      timestamp: Date.now(),
    });

    const { deadLetter } = this.keys();

    const [error] = await mightThrow(this.redis.lpush(deadLetter, entry));

    return error;
  }
}
