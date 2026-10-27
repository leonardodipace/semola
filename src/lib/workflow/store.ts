import { mightThrow } from "../errors/index.js";
import { WorkflowStoreError } from "./errors.js";
import { toJson } from "./json.js";
import type {
  CancelRequestResult,
  CommitInput,
  CommitResult,
  HistoryEvent,
  LeaseInput,
  ReleaseLeaseInput,
  WorkflowMeta,
  WorkflowStatus,
} from "./types.js";

// KEYS: due
// ARGV: now, lockTTL, token, lease key prefix, meta key prefix
// Claims the first due execution whose lease is free: takes the lease and
// pushes its due score out by lockTTL (visibility timeout, so a dead worker's
// execution comes due again). Busy members are pushed to when their lease
// expires; members without meta are dropped. Returns the id or nil.
export const CLAIM_DUE =
  "local now=tonumber(ARGV[1]) local ttl=tonumber(ARGV[2]) for _, id in ipairs(redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, 10)) do local lease=ARGV[4] .. id if redis.call('EXISTS', ARGV[5] .. id) == 0 then redis.call('ZREM', KEYS[1], id) elseif redis.call('SET', lease, ARGV[3], 'PX', ttl, 'NX') then redis.call('ZADD', KEYS[1], now + ttl, id) return id else local left=redis.call('PTTL', lease) if left < 0 then left=ttl end redis.call('ZADD', KEYS[1], now + left, id) end end return false";

// KEYS: capacity
// ARGV: executionId, limit, now, expiry
// Counting semaphore: drops expired holders, then refreshes this execution's
// slot or takes a free one. Returns 1 when admitted, 0 when the key is full.
export const ACQUIRE_CAPACITY =
  "redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[3]) if redis.call('ZSCORE', KEYS[1], ARGV[1]) or redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[2]) then redis.call('ZADD', KEYS[1], ARGV[4], ARGV[1]) return 1 end return 0";

// KEYS: lease, due, capacity
// ARGV: token, lockTTL, executionId, now + lockTTL
// Heartbeat: extends the lease, the visibility timeout and the capacity slot
// (if held) together. The slot is never lowered, so a heartbeat landing after
// a wait's commit keeps the slot through the wait.
export const EXTEND_LEASE =
  "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end redis.call('PEXPIRE', KEYS[1], ARGV[2]) redis.call('ZADD', KEYS[2], 'XX', ARGV[4], ARGV[3]) redis.call('ZADD', KEYS[3], 'XX', 'GT', ARGV[4], ARGV[3]) return 1";

// KEYS: lease, due, capacity
// ARGV: token, executionId, due score, slot expiry
// Releases the lease and lowers (never raises) the due score, so a cancel
// that lowered it after the last commit is kept. A held capacity slot is kept
// until the slot expiry (due + lockTTL), so a sleeping execution keeps it with
// nobody refreshing it.
export const RELEASE_LEASE =
  "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end redis.call('DEL', KEYS[1]) redis.call('ZADD', KEYS[2], 'XX', 'LT', ARGV[3], ARGV[2]) redis.call('ZADD', KEYS[3], 'XX', ARGV[4], ARGV[2]) return 1";

// KEYS: meta, history, due, terminal
// ARGV: executionId, WorkflowStarted payload, now, meta field/value pairs...
// Creates meta + first history event and makes the execution due now, so it
// is never visible without its WorkflowStarted event. A leftover
// terminal-zset member from an expired execution with the same id is dropped
// so retentionMax trimming cannot unlink the new run.
export const CREATE_EXECUTION =
  "if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end redis.call('HSET', KEYS[1], unpack(ARGV, 4)) redis.call('RPUSH', KEYS[2], ARGV[2]) redis.call('ZADD', KEYS[3], ARGV[3], ARGV[1]) redis.call('ZREM', KEYS[4], ARGV[1]) return 1";

// KEYS: lease, history, meta, due, terminal, capacity
// ARGV: token, executionId, event count n, due, ttlMs, trackedAt,
//       slot expiry, n event payloads, meta field/value pairs...
// Lease-fenced write of history events + meta fields. due "" leaves the due
// score, a number sets it (and a held slot's expiry, unless slot expiry is
// ""), "done" marks a terminal transition: leave the due set and the
// capacity key and apply retention (ttlMs "" keeps keys, "0" unlinks
// meta/history/lease, otherwise PEXPIREs meta + history; trackedAt "" skips
// the retentionMax zset).
// Returns 0 when the lease is not held, 2 when committed and meta carries a
// cancel request, 1 when committed otherwise.
export const COMMIT =
  "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end local n=tonumber(ARGV[3]) for i=8,7+n do redis.call('RPUSH', KEYS[2], ARGV[i]) end if #ARGV > 7+n then redis.call('HSET', KEYS[3], unpack(ARGV, 8+n)) end local r=1 local c=redis.call('HGET', KEYS[3], 'cancelRequestedAt') if c and c ~= '' then r=2 end if ARGV[4] == '' then return r end if ARGV[4] ~= 'done' then redis.call('ZADD', KEYS[4], 'XX', ARGV[4], ARGV[2]) if ARGV[7] ~= '' then redis.call('ZADD', KEYS[6], 'XX', ARGV[7], ARGV[2]) end return r end redis.call('ZREM', KEYS[4], ARGV[2]) redis.call('ZREM', KEYS[6], ARGV[2]) local ttl=tonumber(ARGV[5]) if ttl then if ttl <= 0 then redis.call('UNLINK', KEYS[3], KEYS[2], KEYS[1]) redis.call('ZREM', KEYS[5], ARGV[2]) return r end redis.call('PEXPIRE', KEYS[3], ARGV[5]) redis.call('PEXPIRE', KEYS[2], ARGV[5]) end if ARGV[6] ~= '' then redis.call('ZADD', KEYS[5], ARGV[6], ARGV[2]) end return r";

// KEYS: meta, history, due, terminal
// ARGV: executionId, now, WorkflowResumed payload
// Resumes only a failed execution that never started an unwind (`unwoundAt`
// is set in the same commit as CompensationStarted). Clears any cancel
// request that landed before the failure. Returns nil when meta is missing,
// "unwound", the status when it is not "failed", or "resumed".
export const RESUME_EXECUTION =
  "local s=redis.call('HGET', KEYS[1], 'status') if not s then return false end local u=redis.call('HGET', KEYS[1], 'unwoundAt') if u and u ~= '' then return 'unwound' end if s ~= 'failed' then return s end redis.call('PERSIST', KEYS[1]) redis.call('PERSIST', KEYS[2]) redis.call('ZREM', KEYS[4], ARGV[1]) redis.call('RPUSH', KEYS[2], ARGV[3]) redis.call('HSET', KEYS[1], 'status', 'pending', 'error', '', 'failedAt', '', 'cancelRequestedAt', '', 'updatedAt', ARGV[2]) redis.call('ZADD', KEYS[3], ARGV[2], ARGV[1]) return 'resumed'";

// KEYS: meta, due
// ARGV: executionId, now
// Records a cancel request on meta and makes the execution due now (only
// ever lowering its score), unless it is already terminal or compensating
// (then nothing is written). Returns nil when meta is missing, else
// {accepted 0|1, status, updatedAt, cancelledAt, createdAt} as read in the
// same script. Keeps the first request time.
export const CANCEL_EXECUTION =
  "local s=redis.call('HGET', KEYS[1], 'status') if not s then return false end local accepted=0 if s ~= 'completed' and s ~= 'failed' and s ~= 'cancelled' and s ~= 'compensating' then local c=redis.call('HGET', KEYS[1], 'cancelRequestedAt') if not c or c == '' then redis.call('HSET', KEYS[1], 'cancelRequestedAt', ARGV[2]) end redis.call('ZADD', KEYS[2], 'XX', 'LT', ARGV[2], ARGV[1]) accepted=1 end local m=redis.call('HMGET', KEYS[1], 'updatedAt', 'cancelledAt', 'createdAt') return {accepted, s, m[1], m[2], m[3]}";

export const TRIM_IF_MEMBER =
  "if redis.call('ZREM', KEYS[1], ARGV[1]) == 0 then return 0 end redis.call('UNLINK', KEYS[2], KEYS[3], KEYS[4]) return 1";

export const keys = {
  history: (name: string, executionId: string) =>
    `workflow:${name}:history:${executionId}`,
  meta: (name: string, executionId: string) =>
    `workflow:${name}:meta:${executionId}`,
  lease: (name: string, executionId: string) =>
    `workflow:${name}:lease:${executionId}`,
  due: (name: string) => `workflow:${name}:due`,
  terminal: (name: string) => `workflow:${name}:terminal`,
  capacity: (name: string, key: string) => `workflow:${name}:capacity:${key}`,
};

const metaEntries = (fields: Partial<WorkflowMeta>) => {
  const entries: string[] = [];

  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue;

    entries.push(field, value);
  }

  return entries;
};

export class WorkflowStore {
  public constructor(
    private redis: Bun.RedisClient,
    private name: string,
  ) {}

  public async commit(input: CommitInput): Promise<CommitResult> {
    const { executionId, leaseToken, events = [], fields = {} } = input;
    const { retention, dueAt, capacityKey = "*", slotTtlMs } = input;
    const payloads = events.map((event) =>
      toJson(event, `history event for ${executionId}`),
    );
    let due = dueAt === undefined ? "" : String(dueAt);
    let ttl = "";
    let trackedAt = "";
    let slotExpiry = "";

    if (dueAt !== undefined) {
      if (slotTtlMs !== undefined) slotExpiry = String(dueAt + slotTtlMs);
    }

    if (retention) {
      due = "done";

      if (retention.ttlMs !== undefined) {
        // PEXPIRE rejects fractions and huge values; a rejected call would
        // abort the script after the history/meta writes already applied.
        ttl = String(
          Math.min(Math.ceil(retention.ttlMs), Number.MAX_SAFE_INTEGER),
        );
      }

      if (retention.trackedAt !== undefined) {
        trackedAt = String(retention.trackedAt);
      }
    }

    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        COMMIT,
        "6",
        keys.lease(this.name, executionId),
        keys.history(this.name, executionId),
        keys.meta(this.name, executionId),
        keys.due(this.name),
        keys.terminal(this.name),
        keys.capacity(this.name, capacityKey),
        leaseToken,
        executionId,
        String(payloads.length),
        due,
        ttl,
        trackedAt,
        slotExpiry,
        ...payloads,
        ...metaEntries(fields),
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(`Unable to commit ${executionId}`);
    }

    const code = Number(result);

    if (code === 0) return { committed: false };

    return { committed: true, cancelRequested: code === 2 };
  }

  public async requestCancel(
    executionId: string,
  ): Promise<CancelRequestResult | null> {
    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        CANCEL_EXECUTION,
        "2",
        keys.meta(this.name, executionId),
        keys.due(this.name),
        executionId,
        String(Date.now()),
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(`Unable to cancel execution ${executionId}`);
    }

    if (!Array.isArray(result)) return null;

    // Missing hash fields arrive as null (RESP2) or false (RESP3).
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    const [accepted, status, updatedAt, cancelledAt, createdAt] = result;

    return {
      accepted: Number(accepted) === 1,
      status: text(status) as WorkflowStatus,
      updatedAt: text(updatedAt),
      cancelledAt: text(cancelledAt),
      createdAt: text(createdAt),
    };
  }

  public async loadHistory(executionId: string) {
    const [error, rows] = await mightThrow(
      this.redis.lrange(keys.history(this.name, executionId), 0, -1),
    );

    if (error) {
      throw new WorkflowStoreError(`Unable to load history for ${executionId}`);
    }

    return rows ?? [];
  }

  public async createExecution(executionId: string, fields: WorkflowMeta) {
    const started = toJson(
      {
        type: "WorkflowStarted",
        timestamp: Number(fields.createdAt),
      } satisfies HistoryEvent,
      `history event for ${executionId}`,
    );

    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        CREATE_EXECUTION,
        "4",
        keys.meta(this.name, executionId),
        keys.history(this.name, executionId),
        keys.due(this.name),
        keys.terminal(this.name),
        executionId,
        started,
        String(Date.now()),
        ...metaEntries(fields),
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(`Unable to create execution ${executionId}`);
    }

    return Number(result) === 1;
  }

  public async getMeta(executionId: string) {
    const [error, data] = await mightThrow(
      this.redis.hgetall(keys.meta(this.name, executionId)),
    );

    if (error) {
      throw new WorkflowStoreError(`Unable to read meta for ${executionId}`);
    }

    if (!data) return null;

    if (Object.keys(data).length === 0) return null;

    return data as unknown as WorkflowMeta;
  }

  public async claimDue(token: string, ttlMs: number) {
    const [error, executionId] = await mightThrow(
      this.redis.send("EVAL", [
        CLAIM_DUE,
        "1",
        keys.due(this.name),
        String(Date.now()),
        String(ttlMs),
        token,
        keys.lease(this.name, ""),
        keys.meta(this.name, ""),
      ]),
    );

    if (error) {
      throw new WorkflowStoreError("Unable to claim a due execution");
    }

    if (typeof executionId !== "string") return null;

    return executionId;
  }

  public async extendLease(input: LeaseInput) {
    const { executionId, token, ttlMs, capacityKey = "*" } = input;

    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        EXTEND_LEASE,
        "3",
        keys.lease(this.name, executionId),
        keys.due(this.name),
        keys.capacity(this.name, capacityKey),
        token,
        String(ttlMs),
        executionId,
        String(Date.now() + ttlMs),
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(`Unable to extend lease for ${executionId}`);
    }

    return Number(result) === 1;
  }

  // dueAt lowers the due score and keeps a held slot until dueAt + ttlMs.
  public async releaseLease(input: ReleaseLeaseInput) {
    const { executionId, token, ttlMs, capacityKey = "*", dueAt } = input;

    const [error] = await mightThrow(
      this.redis.send("EVAL", [
        RELEASE_LEASE,
        "3",
        keys.lease(this.name, executionId),
        keys.due(this.name),
        keys.capacity(this.name, capacityKey),
        token,
        executionId,
        String(dueAt),
        String(dueAt + ttlMs),
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(
        `Unable to release lease for ${executionId}`,
      );
    }
  }

  public async acquireCapacity(
    capacityKey: string,
    executionId: string,
    limit: number,
    ttlMs: number,
  ) {
    const now = Date.now();

    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        ACQUIRE_CAPACITY,
        "1",
        keys.capacity(this.name, capacityKey),
        executionId,
        String(limit),
        String(now),
        String(now + ttlMs),
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(`Unable to acquire capacity ${capacityKey}`);
    }

    return Number(result) === 1;
  }

  // Returns the RESUME_EXECUTION outcome, or null when meta is missing.
  public async resumeExecution(executionId: string) {
    const now = Date.now();
    const resumed = toJson(
      { type: "WorkflowResumed", timestamp: now } satisfies HistoryEvent,
      `history event for ${executionId}`,
    );

    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        RESUME_EXECUTION,
        "4",
        keys.meta(this.name, executionId),
        keys.history(this.name, executionId),
        keys.due(this.name),
        keys.terminal(this.name),
        executionId,
        String(now),
        resumed,
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(`Unable to resume execution ${executionId}`);
    }

    return typeof result === "string" ? result : null;
  }

  public async trimTerminal(max: number) {
    const terminalKey = keys.terminal(this.name);
    const [cardError, card] = await mightThrow(
      this.redis.send("ZCARD", [terminalKey]),
    );

    if (cardError) {
      throw new WorkflowStoreError("Unable to count terminal executions");
    }

    const extra = Number(card) - max;

    if (extra <= 0) return;

    const [rangeError, oldest] = await mightThrow(
      this.redis.send("ZRANGE", [terminalKey, "0", String(extra - 1)]),
    );

    if (rangeError) {
      throw new WorkflowStoreError("Unable to trim terminal executions");
    }

    for (const executionId of oldest ?? []) {
      const id = String(executionId);

      const [trimError] = await mightThrow(
        this.redis.send("EVAL", [
          TRIM_IF_MEMBER,
          "4",
          terminalKey,
          keys.meta(this.name, id),
          keys.history(this.name, id),
          keys.lease(this.name, id),
          id,
        ]),
      );

      if (trimError) {
        throw new WorkflowStoreError("Unable to trim terminal executions");
      }
    }
  }
}
