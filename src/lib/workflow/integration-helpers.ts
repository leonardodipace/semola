import { WorkflowStore } from "./store.js";
import type { CommitInput, ReleaseLeaseInput } from "./types.js";

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

// Runs `hook` before every releaseLease until restorePatches(). A hook that
// throws leaves Redis as a worker crashing right before the release would.
export const beforeReleaseLease = (
  hook: (input: ReleaseLeaseInput) => void | Promise<void>,
) => {
  const releaseLease = WorkflowStore.prototype.releaseLease;

  WorkflowStore.prototype.releaseLease = async function (input) {
    await hook(input);
    return releaseLease.call(this, input);
  };
  restores.push(() => {
    WorkflowStore.prototype.releaseLease = releaseLease;
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

type FailableCommand = "EVAL" | "LRANGE" | "HGETALL";

// Makes the next `command` sent by this client reject, then restores send.
export const failNext = (redis: Bun.RedisClient, command: FailableCommand) => {
  const send = redis.send.bind(redis);
  const target = redis as unknown as Record<string, unknown>;

  target.send = async (name: string, args: string[]) => {
    if (name !== command) return send(name, args);

    delete target.send;
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
