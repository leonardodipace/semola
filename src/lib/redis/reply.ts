import type { RedisClient } from "./types.js";

// HGETALL comes back as an object, a Map, or a flat field/value list.
const toRecord = (reply: unknown) => {
  if (reply instanceof Map) {
    return Object.fromEntries(reply) as Record<string, string>;
  }

  if (!Array.isArray(reply)) {
    return (reply ?? {}) as Record<string, string>;
  }

  const record: Record<string, string> = {};

  for (let index = 0; index < reply.length; index += 2) {
    record[String(reply[index])] = String(reply[index + 1]);
  }

  return record;
};

export const readHash = async (redis: RedisClient, key: string) => {
  const reply = await redis.send("HGETALL", [key]);

  return toRecord(reply);
};
