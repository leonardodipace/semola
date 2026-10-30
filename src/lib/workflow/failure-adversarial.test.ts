import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  defineWorkflow,
  NonRetryableStepError,
  type Workflow,
} from "./index.js";
import {
  closeRedis,
  createRedis,
  resetRedis,
  SEMOLA_REDIS_URL,
} from "./integration-helpers.js";

const sleep = (ms: number) => Bun.sleep(ms);

const awaitStartSync = async <T>(promise: Promise<T>, timeoutMs = 3000) => {
  const start = Date.now();
  let settled: T | undefined;
  let done = false;

  void promise.then((value) => {
    settled = value;
    done = true;
  });

  while (Date.now() - start < timeoutMs) {
    if (done) return settled as T;

    await sleep(5);
  }

  throw new Error("awaitStartSync timeout");
};

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
) => {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;

    await sleep(5);
  }

  throw new Error("waitFor timeout");
};

const waitStatus = async <TInput, TResult>(
  wf: Workflow<TInput, TResult>,
  executionId: string,
  status: string,
  timeoutMs = 3000,
) => {
  await waitFor(async () => {
    const execution = await wf.get(executionId);
    return execution.status === status;
  }, timeoutMs);

  return wf.get(executionId);
};

const fast = {
  pollInterval: 10,
  lockTTL: 200,
  retryBackoff: { baseDelay: 10, multiplier: 2, maxDelay: 40 },
};

describe.skipIf(!SEMOLA_REDIS_URL)("workflow failure adversarial", () => {
  beforeEach(resetRedis);
  afterEach(closeRedis);

  test("get().error stays a message string while startSync keeps durable name", async () => {
    const redis = createRedis();

    class CardDeclinedError extends Error {}

    const wf = defineWorkflow({
      name: `adv-get-err-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step("charge", async ({ fail }) => {
          fail(new CardDeclinedError("card declined"));
        });
      },
    });

    const result = await awaitStartSync(wf.startSync({}));
    const execution = await wf.get(result.executionId);

    expect(result.error?.name).toBe("CardDeclinedError");
    expect(result.error).not.toBeInstanceOf(CardDeclinedError);
    expect(typeof execution.error).toBe("string");
    expect(execution.error).toBe("card declined");

    await wf.stop();
  });

  test("onError receives live thrown instance", async () => {
    const redis = createRedis();

    class CardDeclinedError extends Error {}
    let hooked: Error | undefined;

    const wf = defineWorkflow({
      name: `adv-onerror-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      hooks: {
        onError: ({ error }) => {
          hooked = error;
        },
      },
      handler: async ({ step }) => {
        await step("charge", async ({ fail }) => {
          fail(new CardDeclinedError("live"));
        });
      },
    });

    const result = await awaitStartSync(wf.startSync({}));

    expect(hooked).toBeInstanceOf(CardDeclinedError);
    expect(result.error?.name).toBe("CardDeclinedError");
    expect(result.error).not.toBeInstanceOf(CardDeclinedError);

    await wf.stop();
  });

  test("empty message preserves durable name", async () => {
    const redis = createRedis();

    class CardDeclinedError extends Error {}

    const wf = defineWorkflow({
      name: `adv-empty-msg-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step("charge", async ({ fail }) => {
          fail(new CardDeclinedError(""));
        });
      },
    });

    const result = await awaitStartSync(wf.startSync({}));

    expect(result.error?.message).toBe("");
    expect(result.error?.name).toBe("CardDeclinedError");

    await wf.stop();
  });

  test("startSync after compensate keeps originalError name", async () => {
    const redis = createRedis();

    class ProvisionError extends Error {}

    const wf = defineWorkflow({
      name: `adv-comp-orig-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step("create", async () => "acct", {
          compensate: async () => {},
        });

        await step("provision", async ({ fail }) => {
          fail(new ProvisionError("provision failed"));
        });
      },
    });

    const result = await awaitStartSync(wf.startSync({}));

    expect(result.error?.name).toBe("ProvisionError");
    expect(result.error?.message).toBe("provision failed");
    expect(result.error).not.toBeInstanceOf(ProvisionError);

    await wf.stop();
  });

  test("resume then fail again keeps durable name", async () => {
    const redis = createRedis();

    class FlakyError extends Error {}
    let attempts = 0;

    const wf = defineWorkflow({
      name: `adv-resume-fail-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      retentionTTL: 60_000,
      handler: async ({ step }) => {
        await step("once", async ({ fail }) => {
          attempts++;

          if (attempts === 1) {
            fail(new FlakyError("first"));
          }

          fail(new FlakyError("second"));
        });
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "failed");

    await wf.resume(executionId);

    const result = await awaitStartSync(wf.startSync({}, { executionId }));

    expect(result.error?.name).toBe("FlakyError");
    expect(result.error?.message).toBe("second");
    expect(attempts).toBe(2);

    await wf.stop();
  });

  test("NonRetryableStepError still revives as itself", async () => {
    const redis = createRedis();

    const wf = defineWorkflow({
      name: `adv-nre-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step("boom", async () => {
          throw new NonRetryableStepError("hard stop");
        });
      },
    });

    const result = await awaitStartSync(wf.startSync({}));

    expect(result.error).toBeInstanceOf(NonRetryableStepError);
    expect(result.error?.message).toBe("hard stop");

    await wf.stop();
  });
});
