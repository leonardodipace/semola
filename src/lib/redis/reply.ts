import type { RedisClient } from "./types.js";

// Lua returns HGETALL as a flat field/value list on every client and protocol.
const READ_HASH = "return redis.call('HGETALL', KEYS[1])";

export const readHash = async (redis: RedisClient, key: string) => {
  const reply = await redis.send("EVAL", [READ_HASH, "1", key]);
  const list = reply as unknown[];
  const fields: string[][] = [];

  for (let index = 0; index < list.length; index += 2) {
    fields.push([String(list[index]), String(list[index + 1])]);
  }

  return Object.fromEntries(fields);
};
