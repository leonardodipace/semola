import { afterAll, describe } from "bun:test";
import {
  closeClients,
  connectNodeRedis,
  SEMOLA_REDIS_URL,
  subscriberTests,
} from "./integration-helpers.js";

afterAll(closeClients);

describe.skipIf(!SEMOLA_REDIS_URL)("fromNodeRedis", () => {
  subscriberTests(connectNodeRedis);
});
