export const SEMOLA_REDIS_URL = process.env.SEMOLA_REDIS_URL;

const clients: Bun.RedisClient[] = [];

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
