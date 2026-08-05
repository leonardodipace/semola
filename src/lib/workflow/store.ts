import { mightThrow, mightThrowSync } from "../errors/index.js";
import { SerializationError, WorkflowStoreError } from "./errors.js";
import type { HistoryEvent } from "./history.js";
import type {
  StepTask,
  TimerTask,
  WorkflowMeta,
  WorkflowStatus,
} from "./types.js";

const RELEASE_IF_OWNER =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

const EXTEND_IF_OWNER =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end";

const CLAIM_DUE_TIMER =
  "local m=redis.call('ZRANGEBYSCORE',KEYS[1],0,ARGV[1],'LIMIT',0,1) if #m==0 then return false end redis.call('ZREM',KEYS[1],m[1]) return m[1]";

const CREATE_META_IF_ABSENT =
  "if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end redis.call('HSET', KEYS[1], unpack(ARGV)) return 1";

const SCHEDULE_TIMER_IF_ABSENT =
  "if redis.call('ZSCORE', KEYS[1], ARGV[2]) ~= false then return 0 end redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2]) return 1";

const stringify = (value: unknown, label: string) => {
  const [error, raw] = mightThrowSync(() => JSON.stringify(value));

  if (error) {
    throw new SerializationError(`Unable to serialize ${label}`);
  }

  if (typeof raw !== "string") {
    throw new SerializationError(`Unable to serialize ${label}`);
  }

  return raw;
};

const keys = {
  history: (name: string, executionId: string) =>
    `workflow:${name}:history:${executionId}`,
  meta: (name: string, executionId: string) =>
    `workflow:${name}:meta:${executionId}`,
  lease: (name: string, executionId: string) =>
    `workflow:${name}:lease:${executionId}`,
  wfQueue: (name: string) => `workflow:${name}:wf-queue`,
  stepQueue: (name: string) => `workflow:${name}:step-queue`,
  timers: (name: string) => `workflow:${name}:timers`,
  active: (name: string) => `workflow:${name}:active`,
  partition: (name: string, partitionKey: string, slot: number) =>
    `workflow:${name}:partition:${partitionKey}:${slot}`,
};

export class WorkflowStore {
  public constructor(
    private redis: Bun.RedisClient,
    private name: string,
  ) {}

  public async appendEvents(executionId: string, events: HistoryEvent[]) {
    if (events.length === 0) return;

    const key = keys.history(this.name, executionId);
    const payloads = events.map((event) =>
      stringify(event, `history event for ${executionId}`),
    );

    const [pushError] = await mightThrow(
      this.redis.send("RPUSH", [key, ...payloads]),
    );

    if (pushError) {
      throw new WorkflowStoreError(
        `Unable to append history for ${executionId}`,
      );
    }
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

  public async tryCreateMeta(executionId: string, fields: WorkflowMeta) {
    const key = keys.meta(this.name, executionId);
    const entries: string[] = [];

    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) continue;

      entries.push(field, value);
    }

    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [CREATE_META_IF_ABSENT, "1", key, ...entries]),
    );

    if (error) {
      throw new WorkflowStoreError(`Unable to create meta for ${executionId}`);
    }

    return Number(result) === 1;
  }

  public async setMeta(executionId: string, fields: Partial<WorkflowMeta>) {
    const entries: string[] = [];

    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) continue;

      entries.push(field, value);
    }

    if (entries.length === 0) return;

    const [error] = await mightThrow(
      this.redis.send("HSET", [keys.meta(this.name, executionId), ...entries]),
    );

    if (error) {
      throw new WorkflowStoreError(`Unable to update meta for ${executionId}`);
    }
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

  public async enqueueWorkflow(executionId: string) {
    const [error] = await mightThrow(
      this.redis.lpush(keys.wfQueue(this.name), executionId),
    );

    if (error) {
      throw new WorkflowStoreError(
        `Unable to enqueue workflow task for ${executionId}`,
      );
    }
  }

  public async dequeueWorkflow() {
    const [error, executionId] = await mightThrow(
      this.redis.rpop(keys.wfQueue(this.name)),
    );

    if (error) {
      throw new WorkflowStoreError("Unable to dequeue workflow task");
    }

    return executionId;
  }

  public async enqueueStep(task: StepTask) {
    const raw = stringify(task, "step task");

    const [pushError] = await mightThrow(
      this.redis.lpush(keys.stepQueue(this.name), raw),
    );

    if (pushError) {
      throw new WorkflowStoreError("Unable to enqueue step task");
    }
  }

  public async dequeueStep() {
    const [error, raw] = await mightThrow(
      this.redis.rpop(keys.stepQueue(this.name)),
    );

    if (error) {
      throw new WorkflowStoreError("Unable to dequeue step task");
    }

    if (!raw) return null;

    const [parseError, task] = mightThrowSync(
      () => JSON.parse(raw) as StepTask,
    );

    if (parseError) {
      throw new SerializationError("Unable to parse step task");
    }

    return task;
  }

  public async scheduleTimer(fireAt: number, task: TimerTask) {
    const raw = stringify(task, "timer task");

    const [zaddError] = await mightThrow(
      this.redis.zadd(keys.timers(this.name), fireAt, raw),
    );

    if (zaddError) {
      throw new WorkflowStoreError("Unable to schedule timer");
    }
  }

  public async scheduleTimerIfAbsent(fireAt: number, task: TimerTask) {
    const raw = stringify(task, "timer task");

    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        SCHEDULE_TIMER_IF_ABSENT,
        "1",
        keys.timers(this.name),
        String(fireAt),
        raw,
      ]),
    );

    if (error) {
      throw new WorkflowStoreError("Unable to schedule timer");
    }

    return Number(result) === 1;
  }

  public async claimDueTimer(now: number) {
    const [error, raw] = await mightThrow(
      this.redis.send("EVAL", [
        CLAIM_DUE_TIMER,
        "1",
        keys.timers(this.name),
        String(now),
      ]),
    );

    if (error) {
      throw new WorkflowStoreError("Unable to claim due timer");
    }

    if (!raw) return null;

    return String(raw);
  }

  public async markActive(executionId: string) {
    const [error] = await mightThrow(
      this.redis.sadd(keys.active(this.name), executionId),
    );

    if (error) {
      throw new WorkflowStoreError(
        `Unable to mark active execution ${executionId}`,
      );
    }
  }

  public async markInactive(executionId: string) {
    const [error] = await mightThrow(
      this.redis.srem(keys.active(this.name), executionId),
    );

    if (error) {
      throw new WorkflowStoreError(
        `Unable to mark inactive execution ${executionId}`,
      );
    }
  }

  public async listActive() {
    const [error, members] = await mightThrow(
      this.redis.smembers(keys.active(this.name)),
    );

    if (error) {
      throw new WorkflowStoreError("Unable to list active executions");
    }

    return members ?? [];
  }

  public async acquireLease(executionId: string, token: string, ttlMs: number) {
    const [error, result] = await mightThrow(
      this.redis.set(
        keys.lease(this.name, executionId),
        token,
        "PX",
        String(ttlMs),
        "NX",
      ),
    );

    if (error) {
      throw new WorkflowStoreError(
        `Unable to acquire lease for ${executionId}`,
      );
    }

    return result === "OK";
  }

  public async extendLease(executionId: string, token: string, ttlMs: number) {
    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        EXTEND_IF_OWNER,
        "1",
        keys.lease(this.name, executionId),
        token,
        String(ttlMs),
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(`Unable to extend lease for ${executionId}`);
    }

    return Number(result) === 1;
  }

  public async releaseLease(executionId: string, token: string) {
    const [error] = await mightThrow(
      this.redis.send("EVAL", [
        RELEASE_IF_OWNER,
        "1",
        keys.lease(this.name, executionId),
        token,
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(
        `Unable to release lease for ${executionId}`,
      );
    }
  }

  public async getLease(executionId: string) {
    const [error, value] = await mightThrow(
      this.redis.get(keys.lease(this.name, executionId)),
    );

    if (error) {
      throw new WorkflowStoreError(`Unable to read lease for ${executionId}`);
    }

    return value;
  }

  public async claimPartition(
    partitionKey: string,
    executionId: string,
    concurrency: number,
    ttlMs: number,
  ) {
    for (let slot = 0; slot < concurrency; slot++) {
      const key = keys.partition(this.name, partitionKey, slot);
      const [error, result] = await mightThrow(
        this.redis.set(key, executionId, "PX", String(ttlMs), "NX"),
      );

      if (error) {
        throw new WorkflowStoreError(
          `Unable to claim partition ${partitionKey}`,
        );
      }

      if (result === "OK") {
        return slot;
      }
    }

    return null;
  }

  public async refreshPartition(
    partitionKey: string,
    slot: number,
    executionId: string,
    ttlMs: number,
  ) {
    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        EXTEND_IF_OWNER,
        "1",
        keys.partition(this.name, partitionKey, slot),
        executionId,
        String(ttlMs),
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(
        `Unable to refresh partition ${partitionKey}`,
      );
    }

    return Number(result) === 1;
  }

  public async releasePartition(
    partitionKey: string,
    slot: number,
    executionId: string,
  ) {
    const [error] = await mightThrow(
      this.redis.send("EVAL", [
        RELEASE_IF_OWNER,
        "1",
        keys.partition(this.name, partitionKey, slot),
        executionId,
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(
        `Unable to release partition ${partitionKey}`,
      );
    }
  }

  public async updateStatus(
    executionId: string,
    status: WorkflowStatus,
    extra: Partial<WorkflowMeta> = {},
  ) {
    await this.setMeta(executionId, {
      ...extra,
      status,
      updatedAt: String(Date.now()),
    });
  }
}
