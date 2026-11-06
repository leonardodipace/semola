import type { RedisClient } from "./types.js";

const pairUp = (list: unknown[]) => {
  const pairs: unknown[][] = [];

  for (let index = 0; index < list.length; index += 2) {
    pairs.push([list[index], list[index + 1]]);
  }

  return pairs;
};

// HGETALL comes back as an object, a Map, or a flat field/value list.
const toEntries = (reply: unknown) => {
  if (reply instanceof Map) return [...reply.entries()];
  if (Array.isArray(reply)) return pairUp(reply);
  if (typeof reply !== "object") return [];
  if (reply === null) return [];

  return Object.entries(reply);
};

export const readHash = async (redis: RedisClient, key: string) => {
  const reply = await redis.send("HGETALL", [key]);
  const fields = new Map<string, string>();

  for (const [field, value] of toEntries(reply)) {
    fields.set(String(field), String(value));
  }

  return Object.fromEntries(fields);
};
