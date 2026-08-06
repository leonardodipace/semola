import type { RedisZMember } from "./types.js";

export class MockRedisClient {
  private strings = new Map<
    string,
    { value: string; expiresAt: number | null }
  >();
  private hashes = new Map<string, Map<string, string>>();
  private lists = new Map<string, string[]>();
  private sets = new Map<string, Set<string>>();
  private zsets = new Map<string, RedisZMember[]>();

  private isExpired(key: string) {
    const entry = this.strings.get(key);

    if (!entry) return true;

    if (entry.expiresAt === null) return false;

    if (Date.now() >= entry.expiresAt) {
      this.strings.delete(key);
      return true;
    }

    return false;
  }

  public async get(key: string) {
    return this.getSync(key);
  }

  public async set(
    key: string,
    value: string,
    mode?: string,
    ttl?: string | number,
    flag?: string,
  ) {
    return this.setSync(key, value, mode, ttl, flag);
  }

  public async del(...keys: string[]) {
    return this.delSync(...keys);
  }

  public async pexpire(key: string, ttlMs: number) {
    return this.pexpireSync(key, ttlMs);
  }

  public async pttl(key: string) {
    const entry = this.strings.get(key);

    if (!entry) return -2;

    if (entry.expiresAt === null) return -1;

    if (Date.now() >= entry.expiresAt) {
      this.strings.delete(key);
      return -2;
    }

    return entry.expiresAt - Date.now();
  }

  public async lpush(key: string, ...values: string[]) {
    const list = this.lists.get(key) ?? [];

    for (const value of values) {
      list.unshift(value);
    }

    this.lists.set(key, list);
    return list.length;
  }

  public async rpush(key: string, ...values: string[]) {
    return this.rpushSync(key, ...values);
  }

  public async rpop(key: string) {
    const list = this.lists.get(key);

    if (!list) return null;

    if (list.length === 0) return null;

    return list.pop() ?? null;
  }

  public async lrange(key: string, start: number, stop: number) {
    const list = this.lists.get(key) ?? [];

    let end = stop + 1;

    if (stop < 0) {
      end = list.length + stop + 1;
    }

    return list.slice(start, end);
  }

  public async hset(key: string, ...fieldValues: string[]) {
    return this.hsetSync(key, fieldValues);
  }

  public async hget(key: string, field: string) {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  public async hgetall(key: string) {
    const hash = this.hashes.get(key);

    if (!hash) return {};

    return Object.fromEntries(hash.entries());
  }

  public async scan(
    cursor: string | number,
    ...options: (string | number)[]
  ): Promise<[string, string[]]> {
    // ponytail: one-shot scan; real Redis paginates
    if (String(cursor) !== "0") return ["0", []];

    const matchAt = options.indexOf("MATCH");
    const pattern = matchAt >= 0 ? String(options[matchAt + 1] ?? "*") : "*";
    const regex = new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    );

    return ["0", [...this.hashes.keys()].filter((key) => regex.test(key))];
  }

  public async sadd(key: string, ...members: string[]) {
    return this.saddSync(key, ...members);
  }

  public async srem(key: string, ...members: string[]) {
    const set = this.sets.get(key);

    if (!set) return 0;

    let removed = 0;

    for (const member of members) {
      if (set.delete(member)) removed++;
    }

    return removed;
  }

  public async smembers(key: string) {
    return [...(this.sets.get(key) ?? [])];
  }

  public async zadd(key: string, score: number, member: string) {
    this.zaddSync(key, score, member);
    return 1;
  }

  public async zrangebyscore(key: string, min: number, max: number) {
    return this.zrangebyscoreSync(key, min, max);
  }

  public async zrem(key: string, ...members: string[]) {
    return this.zremSync(key, members);
  }

  private getSync(key: string) {
    if (this.isExpired(key)) return null;

    return this.strings.get(key)?.value ?? null;
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
      if (!this.isExpired(key)) {
        if (this.strings.has(key)) {
          return null;
        }
      }
    }

    let expiresAt: number | null = null;

    if (ttlMs !== null) {
      expiresAt = Date.now() + ttlMs;
    }

    this.strings.set(key, {
      value,
      expiresAt,
    });

    return "OK";
  }

  private delSync(...keys: string[]) {
    let count = 0;

    for (const key of keys) {
      if (this.strings.delete(key)) count++;
      if (this.hashes.delete(key)) count++;
      if (this.lists.delete(key)) count++;
      if (this.sets.delete(key)) count++;
      if (this.zsets.delete(key)) count++;
    }

    return count;
  }

  private pexpireSync(key: string, ttlMs: number) {
    const entry = this.strings.get(key);

    if (!entry) return 0;

    if (this.isExpired(key)) return 0;

    entry.expiresAt = Date.now() + ttlMs;
    return 1;
  }

  private hsetSync(key: string, fieldValues: string[]) {
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

  private rpushSync(key: string, ...values: string[]) {
    const list = this.lists.get(key) ?? [];

    for (const value of values) {
      list.push(value);
    }

    this.lists.set(key, list);
    return list.length;
  }

  private zaddSync(key: string, score: number, member: string) {
    const zset = this.zsets.get(key) ?? [];
    const existing = zset.findIndex((row) => row.member === member);

    if (existing >= 0) {
      zset[existing] = { score, member };
    } else {
      zset.push({ score, member });
    }

    this.zsets.set(key, zset);
  }

  private zrangebyscoreSync(key: string, min: number, max: number) {
    const zset = this.zsets.get(key) ?? [];

    return zset
      .filter((row) => row.score >= min && row.score <= max)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;

        if (a.member < b.member) return -1;

        if (a.member > b.member) return 1;

        return 0;
      })
      .map((row) => row.member);
  }

  private zremSync(key: string, members: string[]) {
    const zset = this.zsets.get(key) ?? [];
    const next = zset.filter((row) => !members.includes(row.member));
    const removed = zset.length - next.length;

    this.zsets.set(key, next);
    return removed;
  }

  public async send(command: string, args: string[]) {
    if (command === "RPUSH") {
      const [key, ...values] = args;

      return this.rpush(key ?? "", ...values);
    }

    if (command === "HSET") {
      const [key, ...fieldValues] = args;

      return this.hset(key ?? "", ...fieldValues);
    }

    if (command === "HSETNX") {
      const key = args[0] ?? "";
      const field = args[1] ?? "";
      const value = args[2] ?? "";
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

    if (script.includes("ZRANGEBYSCORE")) {
      const now = Number(argv[0]);
      const members = this.zrangebyscoreSync(key, 0, now);
      const member = members[0];

      if (!member) return false;

      this.zremSync(key, [member]);
      return member;
    }

    if (script.includes("ZSCORE")) {
      const fireAt = Number(argv[0]);
      const member = argv[1] ?? "";
      const zset = this.zsets.get(key) ?? [];

      if (zset.some((row) => row.member === member)) return 0;

      this.zaddSync(key, fireAt, member);
      return 1;
    }

    if (script.includes("SADD") && script.includes("EXISTS")) {
      const metaKey = keyArgs[0] ?? "";
      const activeKey = keyArgs[1] ?? "";
      const executionId = argv[0] ?? "";

      if (this.hashes.has(metaKey)) return 0;

      this.hsetSync(metaKey, argv.slice(1));
      this.saddSync(activeKey, executionId);
      return 1;
    }

    if (script.includes("SADD") && script.includes("HSET")) {
      const metaKey = keyArgs[0] ?? "";
      const activeKey = keyArgs[1] ?? "";
      const executionId = argv[0] ?? "";

      this.hsetSync(metaKey, argv.slice(1));
      this.saddSync(activeKey, executionId);
      return 1;
    }

    if (script.includes("EXISTS")) {
      if (this.hashes.has(key)) return 0;

      this.hsetSync(key, argv);
      return 1;
    }

    if (script.includes("RPUSH")) {
      const historyKey = keyArgs[1] ?? "";
      const current = this.getSync(key);

      if (current !== token) return 0;

      this.rpushSync(historyKey, ...argv.slice(1));
      return 1;
    }

    if (script.includes("HSET") && script.includes("GET")) {
      const metaKey = keyArgs[1] ?? "";
      const current = this.getSync(key);

      if (current !== token) return 0;

      this.hsetSync(metaKey, argv.slice(1));
      return 1;
    }

    if (script.includes("SET") && script.includes("NX")) {
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

    if (script.includes("DEL")) {
      const current = this.getSync(key);

      if (current !== token) return 0;

      this.delSync(key);
      return 1;
    }

    if (script.includes("PEXPIRE")) {
      const current = this.getSync(key);

      if (current !== token) return 0;

      return this.pexpireSync(key, Number(argv[1]));
    }

    return 0;
  }

  public expireLeaseNow(key: string) {
    const entry = this.strings.get(key);

    if (entry) {
      entry.expiresAt = Date.now() - 1;
    }
  }

  public clearZset(key: string) {
    this.zsets.delete(key);
  }

  public getStringKeys() {
    return [...this.strings.keys()];
  }

  public getList(key: string) {
    return [...(this.lists.get(key) ?? [])];
  }
}

export const createRedis = () =>
  new MockRedisClient() as MockRedisClient & Bun.RedisClient;
