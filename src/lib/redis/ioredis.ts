import { createRedisAdapter } from "./adapter.js";
import type { IoredisClient, IoredisScanReply } from "./types.js";

const GLOB_SPECIAL_CHARS = /[*?[\]\\]/g;

// ioredis does not apply keyPrefix to SCAN patterns or the keys SCAN returns.
const scanUnderPrefix = async (
  client: IoredisClient,
  prefix: string,
  args: string[],
) => {
  const pattern = prefix.replace(GLOB_SPECIAL_CHARS, "\\$&");
  // After the cursor, SCAN options come as name/value pairs.
  const isMatchOption = (arg: string | undefined, index: number) => {
    if (index % 2 === 0) return false;

    return arg?.toUpperCase() === "MATCH";
  };

  const scanArgs = args.map((arg, index) => {
    if (isMatchOption(args[index - 1], index - 1)) return `${pattern}${arg}`;

    return arg;
  });

  if (!args.some(isMatchOption)) scanArgs.push("MATCH", `${pattern}*`);

  const [cursor, keys] = (await client.call(
    "SCAN",
    ...scanArgs,
  )) as IoredisScanReply;

  return [cursor, keys.map((key) => key.slice(prefix.length))];
};

// ioredis and iovalkey. Subscribe on a separate connection.
export const fromIoredis = (client: IoredisClient) =>
  createRedisAdapter(client, (dispatch) => {
    const prefix = client.options?.keyPrefix;

    client.on("message", dispatch);

    const send = (command: string, args: string[]) => {
      if (prefix) {
        if (command.toUpperCase() === "SCAN") {
          return scanUnderPrefix(client, prefix, args);
        }
      }

      return client.call(command, ...args);
    };

    return {
      send,
      subscribe: (channel) => client.subscribe(channel),
      unsubscribe: (channel) => client.unsubscribe(channel),
    };
  });
