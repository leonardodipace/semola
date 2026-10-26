import { WorkflowStore } from "./store.js";
import type { CommitInput } from "./types.js";

export const SEMOLA_REDIS_URL = process.env.SEMOLA_REDIS_URL;

const clients: Bun.RedisClient[] = [];
const restores: (() => void)[] = [];

// Runs `hook` before every lease-fenced commit until restorePatches(), so a
// test can act at an exact point of a run keyed on what is being committed.
export const beforeCommit = (
  hook: (input: CommitInput) => void | Promise<void>,
) => {
  const commit = WorkflowStore.prototype.commit;

  WorkflowStore.prototype.commit = async function (input) {
    await hook(input);
    return commit.call(this, input);
  };
  restores.push(() => {
    WorkflowStore.prototype.commit = commit;
  });
};

export const restorePatches = () => {
  for (const restore of restores.splice(0).reverse()) restore();
};

export const eventTypes = async (
  redis: Bun.RedisClient,
  name: string,
  executionId: string,
) => {
  const rows = await new WorkflowStore(redis, name).loadHistory(executionId);

  return rows.map((raw) => (JSON.parse(raw) as { type: string }).type);
};

export const createRedis = () => {
  const redis = new Bun.RedisClient(SEMOLA_REDIS_URL);

  clients.push(redis);
  return redis;
};

// Wipes the whole database, so SEMOLA_REDIS_URL must point at a throwaway one.
export const resetRedis = async () => {
  const redis = new Bun.RedisClient(SEMOLA_REDIS_URL);

  await redis.send("FLUSHDB", []);
  redis.close();
};

export const closeRedis = () => {
  restorePatches();

  for (const redis of clients.splice(0)) redis.close();
};

type FailableCommand = "send" | "lrange" | "hgetall";

// Makes the next call to `command` on this client reject, then restores it.
export const failNext = (redis: Bun.RedisClient, command: FailableCommand) => {
  const target = redis as unknown as Record<string, unknown>;

  target[command] = async () => {
    delete target[command];
    throw new Error(`redis ${command} failed`);
  };
};

export const leaseKeys = async (redis: Bun.RedisClient) => {
  const found: string[] = [];
  let cursor = "0";

  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", "*:lease:*");

    found.push(...batch);
    cursor = next;
  } while (cursor !== "0");

  return found;
};

// Simulates a crashed worker whose lease has run out.
export const expireLeases = async (redis: Bun.RedisClient) => {
  for (const key of await leaseKeys(redis)) await redis.del(key);
};
