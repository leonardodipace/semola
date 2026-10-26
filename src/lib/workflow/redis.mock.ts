import {
  ACQUIRE_CAPACITY,
  CANCEL_EXECUTION,
  CLAIM_DUE,
  COMMIT,
  CREATE_EXECUTION,
  EXTEND_LEASE,
  RELEASE_LEASE,
  RESUME_EXECUTION,
  TRIM_IF_MEMBER,
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

  public async rpush(key: string, ...values: string[]) {
    this.maybeFail("rpush");

    return this.rpushSync(key, ...values);
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

    if (String(cursor) !== "0") return ["0", []];

    const matchAt = options.indexOf("MATCH");
    const pattern = matchAt >= 0 ? String(options[matchAt + 1] ?? "*") : "*";
    const regex = new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    );

    // Leave expired hashes in SCAN (tombstones); HGETALL lazy-deletes.
    return ["0", [...this.hashes.keys()].filter((key) => regex.test(key))];
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

  private rpushSync(key: string, ...values: string[]) {
    this.sweep(key);

    const list = this.lists.get(key) ?? [];

    for (const value of values) {
      list.push(value);
    }

    this.lists.set(key, list);
    return list.length;
  }

  // ZADD XX [LT]: only an existing member moves, and with LT only lower.
  private zupdateSync(key: string, score: number, member: string, lt = false) {
    const row = this.zsets.get(key)?.find((entry) => entry.member === member);

    if (!row) return;
    if (lt && score >= row.score) return;

    row.score = score;
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

    if (command === "ZCARD") {
      return this.zcardSync(args[0] ?? "");
    }

    if (command === "ZRANGE") {
      return this.zrangeSync(args[0] ?? "", Number(args[1]), Number(args[2]));
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

    if (script === CLAIM_DUE) {
      const [now, ttl] = [Number(argv[0]), Number(argv[1])];
      const [, , owner = "", leasePrefix = "", metaPrefix = ""] = argv;

      for (const id of this.zrangebyscoreSync(key, -Infinity, now).slice(
        0,
        10,
      )) {
        const lease = leasePrefix + id;

        if (!this.existsSync(metaPrefix + id)) {
          this.zremSync(key, [id]);
        } else if (this.setSync(lease, owner, "PX", ttl, "NX") === "OK") {
          this.zaddSync(key, now + ttl, id);
          return id;
        } else {
          const left = this.pttlSync(lease);

          this.zaddSync(key, now + (left < 0 ? ttl : left), id);
        }
      }

      return null;
    }

    if (script === EXTEND_LEASE) {
      if (this.getSync(key) !== token) return 0;

      this.pexpireSync(key, Number(argv[1]));
      this.zupdateSync(keyArgs[1] ?? "", Number(argv[3]), argv[2] ?? "");
      this.zupdateSync(keyArgs[2] ?? "", Number(argv[3]), argv[2] ?? "");
      return 1;
    }

    if (script === RELEASE_LEASE) {
      if (this.getSync(key) !== token) return 0;

      this.delSync(key);

      if (argv[2]) {
        this.zupdateSync(
          keyArgs[1] ?? "",
          Number(argv[2]),
          argv[1] ?? "",
          true,
        );
        this.zupdateSync(keyArgs[2] ?? "", Number(argv[3]), argv[1] ?? "");
      }

      return 1;
    }

    if (script === ACQUIRE_CAPACITY) {
      const [id = "", limit, now, expiry] = argv;
      const holders = (this.zsets.get(key) ?? []).filter(
        (row) => row.score > Number(now),
      );

      this.zsets.set(key, holders);

      const held = holders.some((row) => row.member === id);

      if (!held && holders.length >= Number(limit)) return 0;

      this.zaddSync(key, Number(expiry), id);
      return 1;
    }

    if (script === CREATE_EXECUTION) {
      const [metaKey = "", historyKey = "", dueKey = "", terminalKey = ""] =
        keyArgs;
      const executionId = argv[0] ?? "";

      if (this.existsSync(metaKey)) return 0;

      this.hsetSync(metaKey, argv.slice(3));
      this.rpushSync(historyKey, argv[1] ?? "");
      this.zaddSync(dueKey, Number(argv[2]), executionId);
      this.zremSync(terminalKey, [executionId]);
      return 1;
    }

    if (script === COMMIT) {
      const [leaseKey = "", historyKey = "", metaKey = ""] = keyArgs;
      const dueKey = keyArgs[3] ?? "";
      const terminalKey = keyArgs[4] ?? "";
      const executionId = argv[1] ?? "";
      const count = Number(argv[2]);
      const due = argv[3] ?? "";
      const ttlRaw = argv[4] ?? "";
      const trackedAt = argv[5] ?? "";
      const payloads = argv.slice(6, 6 + count);
      const fieldValues = argv.slice(6 + count);

      if (this.getSync(leaseKey) !== token) return 0;

      if (payloads.length > 0) this.rpushSync(historyKey, ...payloads);
      if (fieldValues.length > 0) this.hsetSync(metaKey, fieldValues);

      const cancel = this.hashes.get(metaKey)?.get("cancelRequestedAt");
      const code = cancel ? 2 : 1;

      if (due === "") return code;

      if (due !== "done") {
        this.zupdateSync(dueKey, Number(due), executionId);
        return code;
      }

      this.zremSync(dueKey, [executionId]);
      this.zremSync(keyArgs[5] ?? "", [executionId]);

      if (ttlRaw !== "") {
        const ttlMs = Number(ttlRaw);

        if (ttlMs <= 0) {
          this.delSync(metaKey, historyKey, leaseKey);
          this.zremSync(terminalKey, [executionId]);
          return code;
        }

        this.pexpireSync(metaKey, ttlMs);
        this.pexpireSync(historyKey, ttlMs);
      }

      if (trackedAt !== "") {
        this.zaddSync(terminalKey, Number(trackedAt), executionId);
      }

      return code;
    }

    if (script === CANCEL_EXECUTION) {
      const [metaKey = "", dueKey = ""] = keyArgs;
      const executionId = argv[0] ?? "";
      const requestedAt = argv[1] ?? "";

      this.sweep(metaKey);

      const hash = this.hashes.get(metaKey);
      const status = hash?.get("status");

      if (!hash || status === undefined) return null;

      const closed = ["completed", "failed", "cancelled", "compensating"];
      let accepted = 0;

      if (!closed.includes(status)) {
        if (!hash.get("cancelRequestedAt")) {
          this.hsetSync(metaKey, ["cancelRequestedAt", requestedAt]);
        }

        this.zupdateSync(dueKey, Number(requestedAt), executionId, true);
        accepted = 1;
      }

      return [
        accepted,
        status,
        hash.get("updatedAt") ?? null,
        hash.get("cancelledAt") ?? null,
        hash.get("createdAt") ?? null,
      ];
    }

    if (script === RESUME_EXECUTION) {
      const [metaKey = "", historyKey = "", dueKey = "", terminalKey = ""] =
        keyArgs;
      const executionId = argv[0] ?? "";
      const updatedAt = argv[1] ?? "";
      const expectedLength = Number(argv[2]);

      this.sweep(metaKey);
      this.sweep(historyKey);

      if (this.hashes.get(metaKey)?.get("status") !== "failed") return 0;

      if ((this.lists.get(historyKey)?.length ?? 0) !== expectedLength) {
        return 0;
      }

      this.persistSync(metaKey);
      this.persistSync(historyKey);
      this.zremSync(terminalKey, [executionId]);

      const payloads = argv.slice(3);

      if (payloads.length > 0) this.rpushSync(historyKey, ...payloads);

      this.hsetSync(metaKey, [
        "status",
        "pending",
        "error",
        "",
        "failedAt",
        "",
        "cancelRequestedAt",
        "",
        "updatedAt",
        updatedAt,
      ]);
      this.zaddSync(dueKey, Number(updatedAt), executionId);
      return 1;
    }

    if (script === TRIM_IF_MEMBER) {
      const terminalKey = keyArgs[0] ?? "";
      const executionId = argv[0] ?? "";

      if (this.zremSync(terminalKey, [executionId]) === 0) return 0;

      this.delSync(keyArgs[1] ?? "", keyArgs[2] ?? "", keyArgs[3] ?? "");
      return 1;
    }

    return 0;
  }

  public expireLeaseNow(key: string) {
    if (!this.strings.has(key)) return;

    this.expiresAt.set(key, Date.now() - 1);
  }

  public getStringKeys() {
    return [...this.strings.keys()];
  }
}

export const createRedis = () =>
  new MockRedisClient() as MockRedisClient & Bun.RedisClient;
