import { mightThrow } from "../errors/index.js";
import { WorkflowStoreError } from "./errors.js";
import { toJson } from "./json.js";
import type {
  AcquireLeaseInput,
  AppendEventsInput,
  ClaimPartitionInput,
  ExtendLeaseInput,
  PartitionKeyInput,
  RefreshPartitionInput,
  ReleaseOwnedPartitionsInput,
  ReleasePartitionInput,
  SetMetaInput,
  TimerTask,
  UpdateStatusInput,
  WorkflowMeta,
} from "./types.js";

export const RELEASE_IF_OWNER =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

export const EXTEND_IF_OWNER =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end";

export const CLAIM_OR_REOWN_PARTITION =
  "if redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX') then return 1 end if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('PEXPIRE', KEYS[1], ARGV[2]) return 1 end return 0";

export const CLAIM_DUE_TIMER =
  "local m=redis.call('ZRANGEBYSCORE',KEYS[1],0,ARGV[1],'LIMIT',0,1) if #m==0 then return false end redis.call('ZREM',KEYS[1],m[1]) return m[1]";

export const CREATE_META_AND_ACTIVE =
  "if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end redis.call('HSET', KEYS[1], unpack(ARGV, 2)) redis.call('SADD', KEYS[2], ARGV[1]) return 1";

export const UPDATE_META_AND_ACTIVE =
  "redis.call('HSET', KEYS[1], unpack(ARGV, 2)) redis.call('SADD', KEYS[2], ARGV[1]) return 1";

export const SCHEDULE_TIMER_IF_ABSENT =
  "if redis.call('ZSCORE', KEYS[1], ARGV[2]) ~= false then return 0 end redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2]) return 1";

export const APPEND_IF_LEASE =
  "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end for i = 2, #ARGV do redis.call('RPUSH', KEYS[2], ARGV[i]) end return 1";

export const HSET_IF_LEASE =
  "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end redis.call('HSET', KEYS[2], unpack(ARGV, 2)) return 1";

export const PERSIST_EXECUTION =
  "if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end redis.call('PERSIST', KEYS[1]) redis.call('PERSIST', KEYS[2]) redis.call('ZREM', KEYS[3], ARGV[1]) redis.call('HSET', KEYS[1], 'status', 'pending', 'error', '', 'failedAt', '', 'updatedAt', ARGV[2]) return 1";

export const RETAIN_IF_TERMINAL =
  "local s=redis.call('HGET', KEYS[1], 'status') if s~='completed' and s~='failed' and s~='cancelled' then return 0 end local ttl=tonumber(ARGV[2]) if ttl then local pttl=redis.call('PTTL', KEYS[1]) if pttl<=0 then if ttl<=0 then redis.call('UNLINK', KEYS[1], KEYS[2], KEYS[3]) redis.call('SREM', KEYS[4], ARGV[1]) redis.call('ZREM', KEYS[5], ARGV[1]) return 1 end redis.call('PEXPIRE', KEYS[1], ARGV[2]) redis.call('PEXPIRE', KEYS[2], ARGV[2]) end end if ARGV[3]~='' then redis.call('ZADD', KEYS[5], ARGV[3], ARGV[1]) end return 1";

export const TRIM_IF_MEMBER =
  "if redis.call('ZREM', KEYS[1], ARGV[1]) == 0 then return 0 end redis.call('UNLINK', KEYS[2], KEYS[3], KEYS[4]) redis.call('SREM', KEYS[5], ARGV[1]) return 1";

export const keys = {
  history: (name: string, executionId: string) =>
    `workflow:${name}:history:${executionId}`,
  meta: (name: string, executionId: string) =>
    `workflow:${name}:meta:${executionId}`,
  lease: (name: string, executionId: string) =>
    `workflow:${name}:lease:${executionId}`,
  queue: (name: string) => `workflow:${name}:queue`,
  timers: (name: string) => `workflow:${name}:timers`,
  timerDead: (name: string) => `workflow:${name}:timer-dead`,
  active: (name: string) => `workflow:${name}:active`,
  terminal: (name: string) => `workflow:${name}:terminal`,
  partition: (input: PartitionKeyInput) => {
    const { name, partitionKey, slot } = input;

    return `workflow:${name}:partition:${partitionKey}:${slot}`;
  },
};

export class WorkflowStore {
  public constructor(
    private redis: Bun.RedisClient,
    private name: string,
  ) {}

  public async appendEvents(input: AppendEventsInput) {
    const { executionId, events, leaseToken } = input;

    if (events.length === 0) return true;

    const payloads = events.map((event) =>
      toJson(event, `history event for ${executionId}`),
    );

    if (leaseToken === undefined) {
      const [pushError] = await mightThrow(
        this.redis.send("RPUSH", [
          keys.history(this.name, executionId),
          ...payloads,
        ]),
      );

      if (pushError) {
        throw new WorkflowStoreError(
          `Unable to append history for ${executionId}`,
        );
      }

      return true;
    }

    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        APPEND_IF_LEASE,
        "2",
        keys.lease(this.name, executionId),
        keys.history(this.name, executionId),
        leaseToken,
        ...payloads,
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(
        `Unable to append history for ${executionId}`,
      );
    }

    return Number(result) === 1;
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

  public async tryCreateMetaAndActive(
    executionId: string,
    fields: WorkflowMeta,
  ) {
    const metaKey = keys.meta(this.name, executionId);
    const activeKey = keys.active(this.name);
    const entries: string[] = [];

    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) continue;

      entries.push(field, value);
    }

    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        CREATE_META_AND_ACTIVE,
        "2",
        metaKey,
        activeKey,
        executionId,
        ...entries,
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(`Unable to create meta for ${executionId}`);
    }

    return Number(result) === 1;
  }

  public async setMeta(input: SetMetaInput) {
    const { executionId, fields, leaseToken } = input;
    const entries: string[] = [];

    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) continue;

      entries.push(field, value);
    }

    if (entries.length === 0) return true;

    if (leaseToken === undefined) {
      const [error] = await mightThrow(
        this.redis.send("HSET", [
          keys.meta(this.name, executionId),
          ...entries,
        ]),
      );

      if (error) {
        throw new WorkflowStoreError(
          `Unable to update meta for ${executionId}`,
        );
      }

      return true;
    }

    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        HSET_IF_LEASE,
        "2",
        keys.lease(this.name, executionId),
        keys.meta(this.name, executionId),
        leaseToken,
        ...entries,
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(`Unable to update meta for ${executionId}`);
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

  public async enqueue(executionId: string) {
    const [error] = await mightThrow(
      this.redis.lpush(keys.queue(this.name), executionId),
    );

    if (error) {
      throw new WorkflowStoreError(
        `Unable to enqueue workflow task for ${executionId}`,
      );
    }
  }

  public async dequeue() {
    const [error, executionId] = await mightThrow(
      this.redis.rpop(keys.queue(this.name)),
    );

    if (error) {
      throw new WorkflowStoreError("Unable to dequeue workflow task");
    }

    return executionId;
  }

  public async scheduleTimer(fireAt: number, task: TimerTask) {
    const raw = toJson(task, "timer task");

    const [zaddError] = await mightThrow(
      this.redis.zadd(keys.timers(this.name), fireAt, raw),
    );

    if (zaddError) {
      throw new WorkflowStoreError("Unable to schedule timer");
    }
  }

  public async scheduleTimerIfAbsent(fireAt: number, task: TimerTask) {
    const raw = toJson(task, "timer task");

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

  public async deadLetterTimer(raw: string) {
    const [error] = await mightThrow(
      this.redis.lpush(keys.timerDead(this.name), raw),
    );

    if (error) {
      throw new WorkflowStoreError("Unable to dead-letter timer");
    }
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

  public async acquireLease(input: AcquireLeaseInput) {
    const { executionId, token, ttlMs } = input;

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

  public async extendLease(input: ExtendLeaseInput) {
    const { executionId, token, ttlMs } = input;

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

  public async claimPartition(input: ClaimPartitionInput) {
    const { partitionKey, executionId, concurrency, ttlMs } = input;

    for (let slot = 0; slot < concurrency; slot++) {
      const key = keys.partition({ name: this.name, partitionKey, slot });
      const [error, result] = await mightThrow(
        this.redis.send("EVAL", [
          CLAIM_OR_REOWN_PARTITION,
          "1",
          key,
          executionId,
          String(ttlMs),
        ]),
      );

      if (error) {
        throw new WorkflowStoreError(
          `Unable to claim partition ${partitionKey}`,
        );
      }

      if (Number(result) === 1) {
        return slot;
      }
    }

    return null;
  }

  public async refreshPartition(input: RefreshPartitionInput) {
    const { partitionKey, slot, executionId, ttlMs } = input;

    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        EXTEND_IF_OWNER,
        "1",
        keys.partition({ name: this.name, partitionKey, slot }),
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

  public async releasePartition(input: ReleasePartitionInput) {
    const { partitionKey, slot, executionId } = input;

    const [error] = await mightThrow(
      this.redis.send("EVAL", [
        RELEASE_IF_OWNER,
        "1",
        keys.partition({ name: this.name, partitionKey, slot }),
        executionId,
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(
        `Unable to release partition ${partitionKey}`,
      );
    }
  }

  public async releaseOwnedPartitions(input: ReleaseOwnedPartitionsInput) {
    const { partitionKey, executionId, concurrency } = input;

    for (let slot = 0; slot < concurrency; slot++) {
      await this.releasePartition({ partitionKey, slot, executionId });
    }
  }

  public async updateStatus(input: UpdateStatusInput) {
    const { executionId, status, extra = {}, leaseToken } = input;

    return this.setMeta({
      executionId,
      fields: {
        ...extra,
        status,
        updatedAt: String(Date.now()),
      },
      leaseToken,
    });
  }

  public async updateStatusAndMarkActive(input: UpdateStatusInput) {
    const { executionId, status, extra = {} } = input;
    const fields: Record<string, string> = {
      ...extra,
      status,
      updatedAt: String(Date.now()),
    };
    const entries: string[] = [];

    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) continue;

      entries.push(field, value);
    }

    const [error] = await mightThrow(
      this.redis.send("EVAL", [
        UPDATE_META_AND_ACTIVE,
        "2",
        keys.meta(this.name, executionId),
        keys.active(this.name),
        executionId,
        ...entries,
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(
        `Unable to update status and mark active for ${executionId}`,
      );
    }

    return true;
  }

  public async persistExecution(executionId: string) {
    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        PERSIST_EXECUTION,
        "3",
        keys.meta(this.name, executionId),
        keys.history(this.name, executionId),
        keys.terminal(this.name),
        executionId,
        String(Date.now()),
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(
        `Unable to persist execution ${executionId}`,
      );
    }

    return Number(result) === 1;
  }

  public async retainIfTerminal(input: {
    executionId: string;
    ttlMs?: number;
    endedAt?: number;
  }) {
    const { executionId, ttlMs, endedAt } = input;
    const ended = endedAt === undefined ? "" : String(endedAt);
    const ttl = ttlMs === undefined ? "" : String(ttlMs);

    const [error, result] = await mightThrow(
      this.redis.send("EVAL", [
        RETAIN_IF_TERMINAL,
        "5",
        keys.meta(this.name, executionId),
        keys.history(this.name, executionId),
        keys.lease(this.name, executionId),
        keys.active(this.name),
        keys.terminal(this.name),
        executionId,
        ttl,
        ended,
      ]),
    );

    if (error) {
      throw new WorkflowStoreError(`Unable to retain execution ${executionId}`);
    }

    return Number(result) === 1;
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
          "5",
          terminalKey,
          keys.meta(this.name, id),
          keys.history(this.name, id),
          keys.lease(this.name, id),
          keys.active(this.name),
          id,
        ]),
      );

      if (trimError) {
        throw new WorkflowStoreError("Unable to trim terminal executions");
      }
    }
  }

  public async scanMetaIds(cursor: string) {
    const [error, scanned] = await mightThrow(
      this.redis.scan(
        cursor,
        "MATCH",
        `workflow:${this.name}:meta:*`,
        "COUNT",
        50,
      ),
    );

    if (error) {
      throw new WorkflowStoreError("Unable to scan workflow executions");
    }

    if (!scanned) {
      throw new WorkflowStoreError("Unable to scan workflow executions");
    }

    const [next, found] = scanned;
    const prefix = `workflow:${this.name}:meta:`;
    const ids: string[] = [];

    for (const key of found) {
      if (!key.startsWith(prefix)) continue;

      const id = key.slice(prefix.length);

      if (!id) continue;

      ids.push(id);
    }

    return { cursor: next, ids };
  }
}
