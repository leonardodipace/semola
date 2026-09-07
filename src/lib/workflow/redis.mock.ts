import {
  APPEND_IF_LEASE,
  CLAIM_DUE_TIMER,
  CLAIM_OR_REOWN_PARTITION,
  CREATE_META_AND_ACTIVE,
  ENQUEUE_IF_ABSENT,
  EXTEND_IF_OWNER,
  HSET_IF_LEASE,
  PERSIST_EXECUTION,
  RELEASE_IF_OWNER,
  RETAIN_IF_TERMINAL,
  SCHEDULE_TIMER_IF_ABSENT,
  TRIM_IF_MEMBER,
  UPDATE_META_AND_ACTIVE,
} from "./store.js";
import type { RedisZMember } from "./types.js";

export class MockRedisClient {
  private strings = new Map<string, string>();
  private hashes = new Map<string, Map<string, string>>();
  private lists = new Map<string, string[]>();
  private sets = new Map<string, Set<string>>();
  private zsets = new Map<string, RedisZMember[]>();
  private expiresAt = new Map<string, number>();
  private failCommands = new Map<string, number>();

  public failNext(command: string, times = 1) {
    const key = command.toLowerCase();
    this.failCommands.set(key, (this.failCommands.get(key) ?? 0) + times);
  }

  private maybeFail(command: string) {
    const remaining = this.failCommands.get(command);

    if (!remaining) return;

    if (remaining <= 1) {
      this.failCommands.delete(command);
    } else {
      this.failCommands.set(command, remaining - 1);
    }

    throw new Error(`mock redis ${command} failed`);
  }

  private drop(key: string) {
    this.expiresAt.delete(key);
    this.strings.delete(key);
    this.hashes.delete(key);
    this.lists.delete(key);
    this.sets.delete(key);
    this.zsets.delete(key);
  }

  private sweep(key: string) {
    const exp = this.expiresAt.get(key);

    if (exp === undefined) return false;

    if (Date.now() < exp) return false;

    this.drop(key);
    return true;
  }

  private existsSync(key: string) {
    if (this.sweep(key)) return false;
    if (this.strings.has(key)) return true;
    if (this.hashes.has(key)) return true;
    if (this.lists.has(key)) return true;
    if (this.sets.has(key)) return true;
    if (this.zsets.has(key)) return true;

    return false;
  }

  public async get(key: string) {
    this.maybeFail("get");

    return this.getSync(key);
  }

  public async set(
    key: string,
    value: string,
    mode?: string,
    ttl?: string | number,
    flag?: string,
  ) {
    this.maybeFail("set");

    return this.setSync(key, value, mode, ttl, flag);
  }

  public async del(...keys: string[]) {
    this.maybeFail("del");

    return this.delSync(...keys);
  }

  public async pexpire(key: string, ttlMs: number) {
    this.maybeFail("pexpire");

    return this.pexpireSync(key, ttlMs);
  }

  public async pttl(key: string) {
    this.maybeFail("pttl");

    return this.pttlSync(key);
  }

  public async lpush(key: string, ...values: string[]) {
    this.maybeFail("lpush");
    this.sweep(key);

    const list = this.lists.get(key) ?? [];

    for (const value of values) {
      list.unshift(value);
    }

    this.lists.set(key, list);
    return list.length;
  }

  public async rpush(key: string, ...values: string[]) {
    this.maybeFail("rpush");

    return this.rpushSync(key, ...values);
  }

  public async rpop(key: string) {
    this.maybeFail("rpop");
    this.sweep(key);

    const list = this.lists.get(key);

    if (!list) return null;

    if (list.length === 0) return null;

    return list.pop() ?? null;
  }

  public async lrange(key: string, start: number, stop: number) {
    this.maybeFail("lrange");
    this.sweep(key);

    const list = this.lists.get(key) ?? [];

    let end = stop + 1;

    if (stop < 0) {
      end = list.length + stop + 1;
    }

    return list.slice(start, end);
  }

  public async hset(key: string, ...fieldValues: string[]) {
    this.maybeFail("hset");

    return this.hsetSync(key, fieldValues);
  }

  public async hget(key: string, field: string) {
    this.maybeFail("hget");
    this.sweep(key);

    return this.hashes.get(key)?.get(field) ?? null;
  }

  public async hgetall(key: string) {
    this.maybeFail("hgetall");
    this.sweep(key);

    const hash = this.hashes.get(key);

    if (!hash) return {};

    return Object.fromEntries(hash.entries());
  }

  public async scan(
    cursor: string | number,
    ...options: (string | number)[]
  ): Promise<[string, string[]]> {
    this.maybeFail("scan");

    // ponytail: one-shot scan; real Redis paginates
    if (String(cursor) !== "0") return ["0", []];

    const matchAt = options.indexOf("MATCH");
    const pattern = matchAt >= 0 ? String(options[matchAt + 1] ?? "*") : "*";
    const regex = new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    );

    // Leave expired hashes in SCAN (tombstones); HGETALL lazy-deletes.
    return ["0", [...this.hashes.keys()].filter((key) => regex.test(key))];
  }

  public async sadd(key: string, ...members: string[]) {
    this.maybeFail("sadd");

    return this.saddSync(key, ...members);
  }

  public async srem(key: string, ...members: string[]) {
    this.maybeFail("srem");

    return this.sremSync(key, ...members);
  }

  public async smembers(key: string) {
    this.maybeFail("smembers");
    this.sweep(key);

    return [...(this.sets.get(key) ?? [])];
  }

  public async zadd(key: string, score: number, member: string) {
    this.maybeFail("zadd");

    this.zaddSync(key, score, member);
    return 1;
  }

  public async zrangebyscore(key: string, min: number, max: number) {
    this.maybeFail("zrangebyscore");

    return this.zrangebyscoreSync(key, min, max);
  }

  public async zrem(key: string, ...members: string[]) {
    this.maybeFail("zrem");

    return this.zremSync(key, members);
  }

  private getSync(key: string) {
    if (this.sweep(key)) return null;

    return this.strings.get(key) ?? null;
  }

  private setSync(
    key: string,
    value: string,
    mode?: string,
    ttl?: string | number,
    flag?: string,
  ) {
    const args = [mode, ttl, flag].filter((v) => v !== undefined).map(String);
    const nx = args.includes("NX");
    const pxIndex = args.indexOf("PX");

    let ttlMs: number | null = null;

    if (pxIndex >= 0) {
      ttlMs = Number(args[pxIndex + 1]);
    }

    if (nx) {
      if (this.existsSync(key)) return null;
    }

    this.strings.set(key, value);

    if (ttlMs !== null) {
      this.expiresAt.set(key, Date.now() + ttlMs);
    } else {
      this.expiresAt.delete(key);
    }

    return "OK";
  }

  private delSync(...keys: string[]) {
    let count = 0;

    for (const key of keys) {
      if (this.existsSync(key)) count++;

      this.drop(key);
    }

    return count;
  }

  private pexpireSync(key: string, ttlMs: number) {
    if (!this.existsSync(key)) return 0;

    this.expiresAt.set(key, Date.now() + ttlMs);
    return 1;
  }

  private persistSync(key: string) {
    if (!this.existsSync(key)) return 0;

    if (!this.expiresAt.has(key)) return 0;

    this.expiresAt.delete(key);
    return 1;
  }

  private pttlSync(key: string) {
    if (!this.existsSync(key)) return -2;

    const exp = this.expiresAt.get(key);

    if (exp === undefined) return -1;

    return exp - Date.now();
  }

  private hsetSync(key: string, fieldValues: string[]) {
    this.sweep(key);

    const hash = this.hashes.get(key) ?? new Map<string, string>();

    for (let i = 0; i < fieldValues.length; i += 2) {
      const field = fieldValues[i];
      const value = fieldValues[i + 1];

      if (field === undefined) continue;

      if (value === undefined) continue;

      hash.set(field, value);
    }

    this.hashes.set(key, hash);
    return fieldValues.length / 2;
  }

  private saddSync(key: string, ...members: string[]) {
    this.sweep(key);

    const set = this.sets.get(key) ?? new Set<string>();
    let added = 0;

    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added++;
      }
    }

    this.sets.set(key, set);
    return added;
  }

  private sremSync(key: string, ...members: string[]) {
    this.sweep(key);

    const set = this.sets.get(key);

    if (!set) return 0;

    let removed = 0;

    for (const member of members) {
      if (set.delete(member)) removed++;
    }

    return removed;
  }

  private rpushSync(key: string, ...values: string[]) {
    this.sweep(key);

    const list = this.lists.get(key) ?? [];

    for (const value of values) {
      list.push(value);
    }

    this.lists.set(key, list);
    return list.length;
  }

  private zaddSync(key: string, score: number, member: string) {
    this.sweep(key);

    const zset = this.zsets.get(key) ?? [];
    const existing = zset.findIndex((row) => row.member === member);

    if (existing >= 0) {
      zset[existing] = { score, member };
    } else {
      zset.push({ score, member });
    }

    this.zsets.set(key, zset);
  }

  private zsetOrder(a: RedisZMember, b: RedisZMember) {
    if (a.score !== b.score) return a.score - b.score;

    if (a.member < b.member) return -1;

    if (a.member > b.member) return 1;

    return 0;
  }

  private zrangebyscoreSync(key: string, min: number, max: number) {
    this.sweep(key);

    const zset = this.zsets.get(key) ?? [];

    return zset
      .filter((row) => row.score >= min && row.score <= max)
      .sort((a, b) => this.zsetOrder(a, b))
      .map((row) => row.member);
  }

  private zrangeSync(key: string, start: number, stop: number) {
    this.sweep(key);

    const zset = [...(this.zsets.get(key) ?? [])].sort((a, b) =>
      this.zsetOrder(a, b),
    );

    let end = stop + 1;

    if (stop < 0) {
      end = zset.length + stop + 1;
    }

    return zset.slice(start, end).map((row) => row.member);
  }

  private zcardSync(key: string) {
    this.sweep(key);

    return this.zsets.get(key)?.length ?? 0;
  }

  private zremSync(key: string, members: string[]) {
    this.sweep(key);

    const zset = this.zsets.get(key) ?? [];
    const next = zset.filter((row) => !members.includes(row.member));
    const removed = zset.length - next.length;

    this.zsets.set(key, next);
    return removed;
  }

  public async send(command: string, args: string[]) {
    this.maybeFail("send");

    if (command === "RPUSH") {
      const [key, ...values] = args;

      return this.rpush(key ?? "", ...values);
    }

    if (command === "HSET") {
      const [key, ...fieldValues] = args;

      return this.hset(key ?? "", ...fieldValues);
    }

    if (command === "UNLINK" || command === "DEL") {
      return this.delSync(...args);
    }

    if (command === "PEXPIRE") {
      return this.pexpireSync(args[0] ?? "", Number(args[1]));
    }

    if (command === "PERSIST") {
      return this.persistSync(args[0] ?? "");
    }

    if (command === "PTTL") {
      return this.pttlSync(args[0] ?? "");
    }

    if (command === "ZCARD") {
      return this.zcardSync(args[0] ?? "");
    }

    if (command === "ZRANGE") {
      return this.zrangeSync(args[0] ?? "", Number(args[1]), Number(args[2]));
    }

    if (command === "ZREM") {
      return this.zremSync(args[0] ?? "", args.slice(1));
    }

    if (command === "HSETNX") {
      const key = args[0] ?? "";
      const field = args[1] ?? "";
      const value = args[2] ?? "";

      this.sweep(key);

      const hash = this.hashes.get(key) ?? new Map<string, string>();

      if (hash.has(field)) return 0;

      hash.set(field, value);
      this.hashes.set(key, hash);
      return 1;
    }

    if (command !== "EVAL") {
      throw new Error(`Unsupported command ${command}`);
    }

    // EVAL branches stay synchronous (no await) so concurrent send() calls
    // cannot interleave mid-script — matches Redis Lua atomicity.
    const script = args[0] ?? "";
    const numKeys = Number(args[1] ?? "1");
    const keyArgs = args.slice(2, 2 + numKeys);
    const argv = args.slice(2 + numKeys);
    const key = keyArgs[0] ?? "";
    const token = argv[0] ?? "";

    if (script === CLAIM_DUE_TIMER) {
      const now = Number(argv[0]);
      const members = this.zrangebyscoreSync(key, 0, now);
      const member = members[0];

      if (!member) return null;

      this.zremSync(key, [member]);
      return member;
    }

    if (script === SCHEDULE_TIMER_IF_ABSENT) {
      const fireAt = Number(argv[0]);
      const member = argv[1] ?? "";

      this.sweep(key);

      const zset = this.zsets.get(key) ?? [];

      if (zset.some((row) => row.member === member)) return 0;

      this.zaddSync(key, fireAt, member);
      return 1;
    }

    if (script === ENQUEUE_IF_ABSENT) {
      this.sweep(key);

      const list = this.lists.get(key) ?? [];

      if (list.includes(token)) return 0;

      list.unshift(token);
      this.lists.set(key, list);
      return 1;
    }

    if (script === CREATE_META_AND_ACTIVE) {
      const metaKey = keyArgs[0] ?? "";
      const activeKey = keyArgs[1] ?? "";
      const executionId = argv[0] ?? "";

      if (this.existsSync(metaKey)) return 0;

      this.hsetSync(metaKey, argv.slice(1));
      this.saddSync(activeKey, executionId);
      return 1;
    }

    if (script === UPDATE_META_AND_ACTIVE) {
      const metaKey = keyArgs[0] ?? "";
      const activeKey = keyArgs[1] ?? "";
      const executionId = argv[0] ?? "";

      this.hsetSync(metaKey, argv.slice(1));
      this.saddSync(activeKey, executionId);
      return 1;
    }

    if (script === APPEND_IF_LEASE) {
      const historyKey = keyArgs[1] ?? "";
      const current = this.getSync(key);

      if (current !== token) return 0;

      this.rpushSync(historyKey, ...argv.slice(1));
      return 1;
    }

    if (script === HSET_IF_LEASE) {
      const metaKey = keyArgs[1] ?? "";
      const current = this.getSync(key);

      if (current !== token) return 0;

      this.hsetSync(metaKey, argv.slice(1));
      return 1;
    }

    if (script === CLAIM_OR_REOWN_PARTITION) {
      const ttlMs = Number(argv[1]);
      const owned = this.getSync(key);

      if (owned === token) {
        this.pexpireSync(key, ttlMs);
        return 1;
      }

      const result = this.setSync(key, token, "PX", String(ttlMs), "NX");

      if (result === "OK") return 1;

      return 0;
    }

    if (script === RELEASE_IF_OWNER) {
      const current = this.getSync(key);

      if (current !== token) return 0;

      this.delSync(key);
      return 1;
    }

    if (script === EXTEND_IF_OWNER) {
      const current = this.getSync(key);

      if (current !== token) return 0;

      return this.pexpireSync(key, Number(argv[1]));
    }

    if (script === PERSIST_EXECUTION) {
      const metaKey = keyArgs[0] ?? "";
      const historyKey = keyArgs[1] ?? "";
      const terminalKey = keyArgs[2] ?? "";
      const executionId = argv[0] ?? "";
      const updatedAt = argv[1] ?? "";

      if (!this.existsSync(metaKey)) return 0;

      this.persistSync(metaKey);
      this.persistSync(historyKey);
      this.zremSync(terminalKey, [executionId]);
      this.hsetSync(metaKey, [
        "status",
        "pending",
        "error",
        "",
        "failedAt",
        "",
        "updatedAt",
        updatedAt,
      ]);
      return 1;
    }

    if (script === RETAIN_IF_TERMINAL) {
      const metaKey = keyArgs[0] ?? "";
      const historyKey = keyArgs[1] ?? "";
      const leaseKey = keyArgs[2] ?? "";
      const activeKey = keyArgs[3] ?? "";
      const terminalKey = keyArgs[4] ?? "";
      const executionId = argv[0] ?? "";
      const endedAt = argv[2] ?? "";

      this.sweep(metaKey);

      const status = this.hashes.get(metaKey)?.get("status");

      if (status !== "completed") {
        if (status !== "failed") {
          if (status !== "cancelled") return 0;
        }
      }

      const ttlRaw = argv[1] ?? "";

      if (ttlRaw !== "") {
        const ttlMs = Number(ttlRaw);
        const pttl = this.pttlSync(metaKey);

        if (pttl <= 0) {
          if (ttlMs <= 0) {
            this.delSync(metaKey, historyKey, leaseKey);
            this.sremSync(activeKey, executionId);
            this.zremSync(terminalKey, [executionId]);
            return 1;
          }

          this.pexpireSync(metaKey, ttlMs);
          this.pexpireSync(historyKey, ttlMs);
        }
      }

      if (endedAt !== "") {
        this.zaddSync(terminalKey, Number(endedAt), executionId);
      }

      return 1;
    }

    if (script === TRIM_IF_MEMBER) {
      const terminalKey = keyArgs[0] ?? "";
      const executionId = argv[0] ?? "";

      if (this.zremSync(terminalKey, [executionId]) === 0) return 0;

      this.delSync(keyArgs[1] ?? "", keyArgs[2] ?? "", keyArgs[3] ?? "");
      this.sremSync(keyArgs[4] ?? "", executionId);
      return 1;
    }

    return 0;
  }

  public expireLeaseNow(key: string) {
    if (!this.strings.has(key)) return;

    this.expiresAt.set(key, Date.now() - 1);
  }

  public clearZset(key: string) {
    this.zsets.delete(key);
  }

  public getStringKeys() {
    return [...this.strings.keys()];
  }

  public getList(key: string) {
    this.sweep(key);

    return [...(this.lists.get(key) ?? [])];
  }
}

export const createRedis = () =>
  new MockRedisClient() as MockRedisClient & Bun.RedisClient;
