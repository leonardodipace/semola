import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  defineWorkflow,
  listWorkflows,
  NonRetryableStepError,
  type Workflow,
} from "./index.js";
import { createRedis, type MockRedisClient } from "./redis.mock.js";

const drainMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

let advancing = false;

const advanceTimersByTimeAsync = async (ms: number) => {
  if (advancing) {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
    return;
  }

  advancing = true;

  try {
    const done = new Promise<void>((resolve) => setTimeout(resolve, ms));
    const end = Date.now() + ms;

    while (Date.now() < end) {
      if (jest.getTimerCount() === 0) {
        jest.advanceTimersByTime(end - Date.now());
        await drainMicrotasks();
        break;
      }

      const step = Math.min(5, end - Date.now());
      jest.advanceTimersByTime(step);
      await drainMicrotasks();
    }

    await done;
  } finally {
    advancing = false;
  }
};

const sleep = advanceTimersByTimeAsync;

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
) => {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;

    await advanceTimersByTimeAsync(5);
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

const stop = async (wf: { stop: () => Promise<void> }) => {
  const done = wf.stop();
  await advanceTimersByTimeAsync(100);
  await done;
};

const expireLeases = (redis: MockRedisClient) => {
  for (const key of redis.getStringKeys()) {
    if (key.includes(":lease:")) redis.expireLeaseNow(key);
  }
};

const fast = {
  pollInterval: 5,
  lockTTL: 40,
  retryBackoff: { baseDelay: 5, multiplier: 2, maxDelay: 20 },
};

describe("workflow compensate adversarial", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("LIFO unwinds four compensated steps newest-first", async () => {
    const redis = createRedis();
    const order: string[] = [];

    const wf = defineWorkflow({
      name: `adv-lifo4-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        for (const n of [1, 2, 3, 4]) {
          await step(
            `s${n}`,
            async () => {
              order.push(`fwd:${n}`);
              return { n };
            },
            {
              compensate: async ({ result }) => {
                order.push(`comp:${result.n}`);
              },
            },
          );
        }

        await step("boom", async ({ fail }) => {
          fail(new Error("done"));
        });
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe("done");
    expect(order).toEqual([
      "fwd:1",
      "fwd:2",
      "fwd:3",
      "fwd:4",
      "comp:4",
      "comp:3",
      "comp:2",
      "comp:1",
    ]);

    await stop(wf);
  });

  test("LIFO with three compensated steps and mixed skip", async () => {
    const redis = createRedis();
    const order: string[] = [];

    const wf = defineWorkflow({
      name: `adv-lifo3-mix-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "a",
          async () => {
            order.push("a");
            return "A";
          },
          {
            compensate: async () => {
              order.push("undo-a");
            },
          },
        );

        await step("b-no-comp", async () => {
          order.push("b");
          return "B";
        });

        await step(
          "c",
          async () => {
            order.push("c");
            return "C";
          },
          {
            compensate: async () => {
              order.push("undo-c");
            },
          },
        );

        await step(
          "d",
          async () => {
            order.push("d");
            return "D";
          },
          {
            compensate: async () => {
              order.push("undo-d");
            },
          },
        );

        throw new Error("explode");
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "failed");

    expect(order).toEqual(["a", "b", "c", "d", "undo-d", "undo-c", "undo-a"]);

    await stop(wf);
  });

  test("incomplete failed forward step is not compensated", async () => {
    const redis = createRedis();
    const order: string[] = [];

    const wf = defineWorkflow({
      name: `adv-fail-fwd-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "ok",
          async () => {
            order.push("ok");
            return "ok";
          },
          {
            compensate: async () => {
              order.push("undo-ok");
            },
          },
        );

        await step(
          "fragile",
          async () => {
            order.push("fragile");
            throw new Error("fragile boom");
          },
          {
            compensate: async () => {
              order.push("undo-fragile");
            },
          },
        );
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe("fragile boom");
    expect(order).toEqual(["ok", "fragile", "undo-ok"]);
    expect(order).not.toContain("undo-fragile");

    await stop(wf);
  });

  test("first step fail means nothing to compensate", async () => {
    const redis = createRedis();
    let compensateCalls = 0;

    const wf = defineWorkflow({
      name: `adv-first-fail-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "only",
          async () => {
            throw new Error("first fail");
          },
          {
            compensate: async () => {
              compensateCalls++;
            },
          },
        );
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe("first fail");
    expect(compensateCalls).toBe(0);
    expect(execution.status).toBe("failed");

    await stop(wf);
  });

  test("cancel during running compensates completed steps then cancelled", async () => {
    const redis = createRedis();
    const order: string[] = [];
    let gate: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
      gate = resolve;
    });

    const wf = defineWorkflow({
      name: `adv-cancel-run-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "setup",
          async () => {
            order.push("setup");
            return { id: "x" };
          },
          {
            compensate: async ({ result }) => {
              order.push(`undo:${result.id}`);
            },
          },
        );

        await step("hang", async () => {
          order.push("hang");
          await released;
          return 1;
        });
      },
    });

    const { executionId } = await wf.start({});

    await waitFor(() => order.includes("hang"));
    await wf.cancel(executionId);
    gate?.();

    const execution = await waitStatus(wf, executionId, "cancelled");

    expect(execution.status).toBe("cancelled");
    expect(order).toContain("undo:x");
    expect(execution.cancelledAt).not.toBeNull();

    await stop(wf);
  });

  test("cancel during durable sleep compensates then cancelled", async () => {
    const redis = createRedis();
    const order: string[] = [];

    const wf = defineWorkflow({
      name: `adv-cancel-sleep-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step, sleep: durableSleep }) => {
        await step(
          "book",
          async () => {
            order.push("book");
            return "res-1";
          },
          {
            compensate: async ({ result }) => {
              order.push(`release:${result}`);
            },
          },
        );

        await durableSleep(50_000);
        order.push("after-sleep");
      },
    });

    const { executionId } = await wf.start({});

    await waitFor(async () => {
      const execution = await wf.get(executionId);
      return execution.steps.some((s) => s.name === "book");
    });

    await wf.cancel(executionId);
    const execution = await waitStatus(wf, executionId, "cancelled");

    expect(execution.status).toBe("cancelled");
    expect(order).toEqual(["book", "release:res-1"]);
    expect(order).not.toContain("after-sleep");

    await stop(wf);
  });

  test("cancel during forward retry backoff compensates completed prior step", async () => {
    const redis = createRedis();
    const order: string[] = [];

    const wf = defineWorkflow({
      name: `adv-cancel-backoff-${crypto.randomUUID()}`,
      redis,
      pollInterval: 5,
      lockTTL: 40,
      retries: 5,
      retryBackoff: { baseDelay: 10_000, multiplier: 1, maxDelay: 10_000 },
      handler: async ({ step }) => {
        await step(
          "prior",
          async () => {
            order.push("prior");
            return 1;
          },
          {
            compensate: async () => {
              order.push("undo-prior");
            },
          },
        );

        await step("flaky", async () => {
          order.push("flaky");
          throw new Error("again");
        });
      },
    });

    const { executionId } = await wf.start({});

    await waitFor(() => order.includes("flaky"));
    await wf.cancel(executionId);

    const execution = await waitStatus(wf, executionId, "cancelled");

    expect(execution.status).toBe("cancelled");
    expect(order).toContain("undo-prior");

    await stop(wf);
  });

  test("compensate retries:0 fails on first compensate error", async () => {
    const redis = createRedis();
    let attempts = 0;

    const wf = defineWorkflow({
      name: `adv-comp-r0-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step("create", async () => ({ id: 1 }), {
          compensate: async () => {
            attempts++;
            throw new Error("undo fail");
          },
        });

        await step("later", async ({ fail }) => {
          fail(new Error("later fail"));
        });
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(attempts).toBe(1);
    expect(execution.error).toBe("undo fail");

    await stop(wf);
  });

  test("compensate default retries means four attempts then compensation error", async () => {
    const redis = createRedis();
    let attempts = 0;

    const wf = defineWorkflow({
      name: `adv-comp-default-${crypto.randomUUID()}`,
      redis,
      pollInterval: 5,
      lockTTL: 40,
      retryBackoff: { baseDelay: 5, multiplier: 1, maxDelay: 5 },
      handler: async ({ step }) => {
        await step("create", async () => ({ id: 1 }), {
          compensate: async () => {
            attempts++;
            throw new Error("always undo fail");
          },
        });

        await step("later", async ({ fail }) => {
          fail(new Error("later fail"));
        });
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed", 8000);

    expect(attempts).toBe(4);
    expect(execution.error).toBe("always undo fail");

    await stop(wf);
  });

  test("thrown NonRetryableStepError in compensate skips retries", async () => {
    const redis = createRedis();
    let attempts = 0;

    const wf = defineWorkflow({
      name: `adv-comp-nre-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 3,
      handler: async ({ step }) => {
        await step("create", async () => 1, {
          compensate: async () => {
            attempts++;
            throw new NonRetryableStepError("hard undo");
          },
        });

        throw new Error("forward fail");
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(attempts).toBe(1);
    expect(execution.error).toBe("hard undo");

    await stop(wf);
  });

  test("compensating status visible via get during hang", async () => {
    const redis = createRedis();
    let hang = true;
    const statuses: string[] = [];

    const wf = defineWorkflow({
      name: `adv-status-get-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step("create", async () => 1, {
          compensate: async () => {
            while (hang) {
              await sleep(10);
            }
          },
        });

        throw new Error("boom");
      },
    });

    const { executionId } = await wf.start({});

    await waitFor(async () => {
      const execution = await wf.get(executionId);
      statuses.push(execution.status);
      return execution.status === "compensating";
    });

    expect(statuses).toContain("compensating");

    hang = false;
    const execution = await waitStatus(wf, executionId, "failed");
    expect(execution.error).toBe("boom");

    await stop(wf);
  });

  test("listWorkflows includes compensating status", async () => {
    const redis = createRedis();
    let hang = true;
    const name = `adv-list-comp-${crypto.randomUUID()}`;

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step("create", async () => 1, {
          compensate: async () => {
            while (hang) {
              await sleep(10);
            }
          },
        });

        throw new Error("boom");
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "compensating");

    const listed = await listWorkflows(redis, {
      name,
      status: "compensating",
    });

    expect(listed.some((item) => item.id === executionId)).toBe(true);

    hang = false;
    await waitStatus(wf, executionId, "failed");
    await stop(wf);
  });

  test("resume rejected while status is compensating", async () => {
    const redis = createRedis();
    let hang = true;

    const wf = defineWorkflow({
      name: `adv-resume-comping-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step("create", async () => 1, {
          compensate: async () => {
            while (hang) {
              await sleep(10);
            }
          },
        });

        throw new Error("boom");
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "compensating");

    await expect(wf.resume(executionId)).rejects.toThrow();

    hang = false;
    await waitStatus(wf, executionId, "failed");
    await stop(wf);
  });

  test("resume allowed when completed steps had no compensate option", async () => {
    const redis = createRedis();
    let attempts = 0;

    const wf = defineWorkflow({
      name: `adv-resume-no-opt-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step("prior", async () => "cached");

        const value = await step("once", async () => {
          attempts++;

          if (attempts === 1) throw new Error("boom");

          return "ok";
        });

        return value;
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "failed");

    await wf.resume(executionId);
    const execution = await waitStatus(wf, executionId, "completed");

    expect(execution.result).toBe("ok");
    expect(attempts).toBe(2);

    await stop(wf);
  });

  test("onRetry not called for compensate retries", async () => {
    const redis = createRedis();
    const retrySteps: string[] = [];
    let compensateAttempts = 0;

    const wf = defineWorkflow({
      name: `adv-onretry-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 2,
      hooks: {
        onRetry: ({ stepName }) => {
          retrySteps.push(stepName);
        },
      },
      handler: async ({ step }) => {
        await step("create", async () => 1, {
          compensate: async () => {
            compensateAttempts++;

            if (compensateAttempts < 3) {
              throw new Error("busy");
            }
          },
        });

        await step("later", async ({ fail }) => {
          fail(new Error("later"));
        });
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "failed");

    expect(compensateAttempts).toBe(3);
    expect(retrySteps).toEqual([]);

    await stop(wf);
  });

  test("onError fires for forward fail() before successful compensate unwind", async () => {
    const redis = createRedis();
    const errors: string[] = [];
    let onCancelCalls = 0;
    let onCompleteCalls = 0;
    let compensateDone = false;

    const wf = defineWorkflow({
      name: `adv-onerror-ok-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      hooks: {
        onError: ({ error }) => {
          errors.push(error.message);
        },
        onCancel: () => {
          onCancelCalls++;
        },
        onComplete: () => {
          onCompleteCalls++;
        },
      },
      handler: async ({ step }) => {
        await step("create", async () => 1, {
          compensate: async () => {
            compensateDone = true;
          },
        });

        await step("later", async ({ fail }) => {
          fail(new Error("original"));
        });
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe("original");
    expect(compensateDone).toBe(true);
    expect(errors).toContain("original");
    expect(onCancelCalls).toBe(0);
    expect(onCompleteCalls).toBe(0);

    await stop(wf);
  });

  test("onError includes compensation error when compensate exhausts after forward fail", async () => {
    const redis = createRedis();
    const errors: string[] = [];
    const compensateHistories: number[] = [];

    const wf = defineWorkflow({
      name: `adv-onerror-comp-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      hooks: {
        onError: ({ error, stepName, errorHistory }) => {
          errors.push(error.message);

          if (stepName === "create") {
            compensateHistories.push(errorHistory.length);
          }
        },
      },
      handler: async ({ step }) => {
        await step("create", async () => 1, {
          compensate: async () => {
            throw new Error("comp err");
          },
        });

        await step("later", async ({ fail }) => {
          fail(new Error("original"));
        });
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe("comp err");
    expect(errors).toContain("original");
    expect(errors).toContain("comp err");
    expect(compensateHistories).toEqual([1]);

    await stop(wf);
  });
  test("onCancel fires after successful cancel-driven compensate", async () => {
    const redis = createRedis();
    let onCancelCalls = 0;
    let onErrorCalls = 0;

    const wf = defineWorkflow({
      name: `adv-oncancel-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      hooks: {
        onCancel: () => {
          onCancelCalls++;
        },
        onError: () => {
          onErrorCalls++;
        },
      },
      handler: async ({ step, sleep: durableSleep }) => {
        await step("create", async () => 1, {
          compensate: async () => {},
        });

        await durableSleep(50_000);
      },
    });

    const { executionId } = await wf.start({});

    await waitFor(async () => {
      const execution = await wf.get(executionId);
      return execution.steps.some((s) => s.name === "create");
    });

    await wf.cancel(executionId);
    await waitStatus(wf, executionId, "cancelled");

    expect(onCancelCalls).toBe(1);
    expect(onErrorCalls).toBe(0);

    await stop(wf);
  });

  test("compensate receives workflow input and step result", async () => {
    const redis = createRedis();
    let seenInput: unknown;
    let seenResult: unknown;

    const wf = defineWorkflow<{ userId: string }, void>({
      name: `adv-ctx-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ input, step }) => {
        await step(
          "create",
          async () => ({ accountId: `acc-${input.userId}` }),
          {
            compensate: async ({ input: compInput, result }) => {
              seenInput = compInput;
              seenResult = result;
            },
          },
        );

        throw new Error("boom");
      },
    });

    const { executionId } = await wf.start({ userId: "u42" });
    await waitStatus(wf, executionId, "failed");

    expect(seenInput).toEqual({ userId: "u42" });
    expect(seenResult).toEqual({ accountId: "acc-u42" });

    await stop(wf);
  });

  test("compensate signal is not aborted when cancel aborts forward signal", async () => {
    const redis = createRedis();
    let forwardAbortedDuringHang = false;
    let compensateAborted = true;
    let hang = true;

    const wf = defineWorkflow({
      name: `adv-signal-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step, signal, sleep: durableSleep }) => {
        await step("create", async () => 1, {
          compensate: async ({ signal: compSignal }) => {
            compensateAborted = compSignal.aborted;

            while (hang) {
              if (compSignal.aborted) {
                compensateAborted = true;
                return;
              }

              await sleep(10);
            }
          },
        });

        await durableSleep(50_000);
        forwardAbortedDuringHang = signal.aborted;
      },
    });

    const { executionId } = await wf.start({});

    await waitFor(async () => {
      const execution = await wf.get(executionId);
      return execution.steps.some((s) => s.name === "create");
    });

    await wf.cancel(executionId);
    await waitStatus(wf, executionId, "compensating");

    expect(compensateAborted).toBe(false);

    hang = false;
    await waitStatus(wf, executionId, "cancelled");

    expect(forwardAbortedDuringHang).toBe(false);

    await stop(wf);
  });

  test("stop during compensate does not abort compensate signal", async () => {
    const redis = createRedis();
    let hang = true;
    let sawAbort = false;
    let finished = false;

    const wf = defineWorkflow({
      name: `adv-stop-signal-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step("create", async () => 1, {
          compensate: async ({ signal }) => {
            while (hang) {
              if (signal.aborted) {
                sawAbort = true;
                return;
              }

              await sleep(10);
            }

            finished = true;
          },
        });

        throw new Error("boom");
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "compensating");

    const done = wf.stop();
    hang = false;
    await advanceTimersByTimeAsync(100);
    await done;

    const execution = await wf.get(executionId);

    expect(sawAbort).toBe(false);
    expect(finished).toBe(true);
    expect(execution.status).toBe("failed");
  });

  test("at-least-once re-entry if reclaim mid-compensate", async () => {
    const redis = createRedis();
    const name = `adv-reentry-${crypto.randomUUID()}`;
    const order: string[] = [];
    let hang = true;
    let crashOnce = true;

    const make = () =>
      defineWorkflow({
        name,
        redis,
        ...fast,
        retries: 0,
        lockTTL: 60,
        handler: async ({ step }) => {
          await step(
            "a",
            async () => {
              order.push("a");
              return 1;
            },
            {
              compensate: async () => {
                order.push("undo-a");
              },
            },
          );

          await step(
            "b",
            async () => {
              order.push("b");
              return 2;
            },
            {
              compensate: async () => {
                order.push("undo-b");

                if (crashOnce) {
                  crashOnce = false;

                  while (hang) {
                    await sleep(10);
                  }

                  throw new Error("reclaim me");
                }
              },
            },
          );

          throw new Error("forward");
        },
      });

    const wf1 = make();
    const { executionId } = await wf1.start({});

    await waitFor(() => order.includes("undo-b"));
    expireLeases(redis);
    hang = false;
    await stop(wf1);

    const wf2 = make();
    const execution = await waitStatus(wf2, executionId, "failed");

    expect(execution.error).toBe("forward");
    expect(order.filter((x) => x === "undo-b").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(order.filter((x) => x === "undo-a").length).toBe(1);

    await stop(wf2);
  });

  test("cancel mid-handler records completed step and compensates", async () => {
    const redis = createRedis();
    const order: string[] = [];
    let executionId = "";
    let laterRan = false;

    const wf = defineWorkflow({
      name: `adv-mid-handler-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "create",
          async () => {
            order.push("create-start");
            await wf.cancel(executionId);
            order.push("create-end");
            return { id: "x" };
          },
          {
            compensate: async ({ result }) => {
              order.push(`undo:${result.id}`);
            },
          },
        );

        await step("later", async () => {
          laterRan = true;
        });
      },
    });

    const started = await wf.start({});
    executionId = started.executionId;

    const execution = await waitStatus(wf, executionId, "cancelled");

    expect(execution.status).toBe("cancelled");
    expect(execution.steps.some((s) => s.name === "create")).toBe(true);
    expect(execution.steps.some((s) => s.name === "later")).toBe(false);
    expect(order).toContain("create-end");
    expect(order).toContain("undo:x");
    expect(laterRan).toBe(false);

    await stop(wf);
  });
  test("successful compensate unwind keeps original forward error", async () => {
    const redis = createRedis();

    const wf = defineWorkflow({
      name: `adv-orig-err-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step("a", async () => 1, {
          compensate: async () => {},
        });
        await step("b", async () => 2, {
          compensate: async () => {},
        });

        throw new Error("keep me");
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.status).toBe("failed");
    expect(execution.error).toBe("keep me");
    expect(execution.failedAt).not.toBeNull();
    expect(execution.cancelledAt).toBeNull();

    await stop(wf);
  });

  test("partial compensate success then later compensate fail uses later error", async () => {
    const redis = createRedis();
    const order: string[] = [];

    const wf = defineWorkflow({
      name: `adv-partial-comp-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "a",
          async () => {
            order.push("a");
            return 1;
          },
          {
            compensate: async () => {
              order.push("undo-a");
              throw new Error("a undo fail");
            },
          },
        );

        await step(
          "b",
          async () => {
            order.push("b");
            return 2;
          },
          {
            compensate: async () => {
              order.push("undo-b");
            },
          },
        );

        throw new Error("forward");
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(order).toEqual(["a", "b", "undo-b", "undo-a"]);
    expect(execution.error).toBe("a undo fail");

    await stop(wf);
  });

  test("void step result compensate receives undefined-compatible result", async () => {
    const redis = createRedis();
    let saw: unknown = "unset";

    const wf = defineWorkflow({
      name: `adv-void-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "side",
          async () => {
            return;
          },
          {
            compensate: async ({ result }) => {
              saw = result;
            },
          },
        );

        throw new Error("x");
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "failed");

    expect(saw === null || saw === undefined).toBe(true);

    await stop(wf);
  });

  test("concurrent cancel race after completed compensate-capable step", async () => {
    const redis = createRedis();
    const order: string[] = [];

    const wf = defineWorkflow({
      name: `adv-race-cancel-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      concurrency: 2,
      handler: async ({ step }) => {
        await step(
          "a",
          async () => {
            order.push("a");
            return 1;
          },
          {
            compensate: async () => {
              order.push("undo-a");
            },
          },
        );

        await step("b", async () => {
          order.push("b");
          await sleep(30);
          return 2;
        });
      },
    });

    const { executionId } = await wf.start({});

    await waitFor(async () => {
      const execution = await wf.get(executionId);
      return execution.steps.some((s) => s.name === "a");
    });

    await Promise.all([wf.cancel(executionId), wf.cancel(executionId)]);

    const execution = await waitStatus(wf, executionId, "cancelled");

    expect(execution.status).toBe("cancelled");
    expect(order.filter((x) => x === "undo-a").length).toBe(1);

    await stop(wf);
  });

  test("compensating then terminal failed clears compensating from list active filter", async () => {
    const redis = createRedis();
    const name = `adv-list-clear-${crypto.randomUUID()}`;

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step("a", async () => 1, {
          compensate: async () => {},
        });

        throw new Error("x");
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "failed");

    const stillComp = await listWorkflows(redis, {
      name,
      status: "compensating",
    });

    expect(stillComp.some((item) => item.id === executionId)).toBe(false);

    const failed = await listWorkflows(redis, { name, status: "failed" });
    expect(failed.some((item) => item.id === executionId)).toBe(true);

    await stop(wf);
  });

  test("cancel mid-second-step: if handler finishes, that step is completed and compensated", async () => {
    const redis = createRedis();
    const order: string[] = [];
    let releaseHang: (() => void) | undefined;
    const hangPromise = new Promise<void>((resolve) => {
      releaseHang = resolve;
    });

    const wf = defineWorkflow({
      name: `adv-partial-complete-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "done",
          async () => {
            order.push("done");
            return 1;
          },
          {
            compensate: async () => {
              order.push("undo-done");
            },
          },
        );

        await step(
          "running",
          async () => {
            order.push("running");
            await hangPromise;
            return 2;
          },
          {
            compensate: async () => {
              order.push("undo-running");
            },
          },
        );
      },
    });

    const { executionId } = await wf.start({});
    await waitFor(() => order.includes("running"));
    await wf.cancel(executionId);
    releaseHang?.();

    await waitStatus(wf, executionId, "cancelled");

    expect(order).toContain("undo-done");
    expect(order).toContain("undo-running");
    expect(order.indexOf("undo-running")).toBeLessThan(
      order.indexOf("undo-done"),
    );

    await stop(wf);
  });

  test("incomplete second step that aborts without result is not compensated", async () => {
    const redis = createRedis();
    const order: string[] = [];

    const wf = defineWorkflow({
      name: `adv-abort-incomplete-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "done",
          async () => {
            order.push("done");
            return 1;
          },
          {
            compensate: async () => {
              order.push("undo-done");
            },
          },
        );

        await step(
          "running",
          async ({ signal }) => {
            order.push("running");

            while (!signal.aborted) {
              await sleep(10);
            }

            throw new NonRetryableStepError("aborted");
          },
          {
            compensate: async () => {
              order.push("undo-running");
            },
          },
        );
      },
    });

    const { executionId } = await wf.start({});
    await waitFor(() => order.includes("running"));
    await wf.cancel(executionId);

    await waitStatus(wf, executionId, "cancelled");

    expect(order).toContain("undo-done");
    expect(order).not.toContain("undo-running");

    await stop(wf);
  });

  test("sleep between compensated steps still LIFO on failure", async () => {
    const redis = createRedis();
    const order: string[] = [];

    const wf = defineWorkflow({
      name: `adv-sleep-lifo-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step, sleep: durableSleep }) => {
        await step(
          "a",
          async () => {
            order.push("a");
            return 1;
          },
          {
            compensate: async () => {
              order.push("undo-a");
            },
          },
        );

        await durableSleep(20);

        await step(
          "b",
          async () => {
            order.push("b");
            return 2;
          },
          {
            compensate: async () => {
              order.push("undo-b");
            },
          },
        );

        throw new Error("end");
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "failed");

    expect(order).toEqual(["a", "b", "undo-b", "undo-a"]);

    await stop(wf);
  });

  test("resume rejected after cancel-driven successful compensate", async () => {
    const redis = createRedis();

    const wf = defineWorkflow({
      name: `adv-resume-cancel-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step, sleep: durableSleep }) => {
        await step("a", async () => 1, {
          compensate: async () => {},
        });

        await durableSleep(50_000);
      },
    });

    const { executionId } = await wf.start({});

    await waitFor(async () => {
      const execution = await wf.get(executionId);
      return execution.steps.some((s) => s.name === "a");
    });

    await wf.cancel(executionId);
    await waitStatus(wf, executionId, "cancelled");

    await expect(wf.resume(executionId)).rejects.toThrow();

    await stop(wf);
  });

  test("nondeterminism during compensate collect does not partial-unwind", async () => {
    const redis = createRedis();
    const order: string[] = [];
    let renameSecond = false;

    const wf = defineWorkflow({
      name: `adv-collect-nondet-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "a",
          async () => {
            order.push("a");
            return 1;
          },
          {
            compensate: async () => {
              order.push("undo-a");
            },
          },
        );

        let secondName = "b";

        if (renameSecond) {
          secondName = "b-renamed";
        }

        await step(
          secondName,
          async () => {
            order.push("b");
            return 2;
          },
          {
            compensate: async () => {
              order.push("undo-b");
            },
          },
        );

        renameSecond = true;
        throw new Error("boom");
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe("boom");
    expect(order).toEqual(["a", "b"]);
    expect(order).not.toContain("undo-a");
    expect(order).not.toContain("undo-b");

    await stop(wf);
  });

  test("early return mid collect does not partial-unwind", async () => {
    const redis = createRedis();
    const order: string[] = [];
    let shorten = false;

    const wf = defineWorkflow({
      name: `adv-collect-return-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "a",
          async () => {
            order.push("a");
            return 1;
          },
          {
            compensate: async () => {
              order.push("undo-a");
            },
          },
        );

        if (shorten) return { ok: true };

        await step(
          "b",
          async () => {
            order.push("b");
            return 2;
          },
          {
            compensate: async () => {
              order.push("undo-b");
            },
          },
        );

        shorten = true;
        throw new Error("boom");
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe("boom");
    expect(order).toEqual(["a", "b"]);
    expect(order).not.toContain("undo-a");
    expect(order).not.toContain("undo-b");

    await stop(wf);
  });

  test("handler throw mid collect does not partial-unwind", async () => {
    const redis = createRedis();
    const order: string[] = [];
    let collectPoison = false;

    const wf = defineWorkflow({
      name: `adv-collect-poison-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "a",
          async () => {
            order.push("a");
            return 1;
          },
          {
            compensate: async () => {
              order.push("undo-a");
            },
          },
        );

        if (collectPoison) {
          throw new Error("collect poison");
        }

        await step(
          "b",
          async () => {
            order.push("b");
            return 2;
          },
          {
            compensate: async () => {
              order.push("undo-b");
            },
          },
        );

        collectPoison = true;
        throw new Error("boom");
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe("boom");
    expect(order).toEqual(["a", "b"]);
    expect(order).not.toContain("undo-a");
    expect(order).not.toContain("undo-b");

    await stop(wf);
  });

  test("missing compensate handlers after CompensationStarted fail closed", async () => {
    const redis = createRedis();
    const order: string[] = [];
    let handlerPasses = 0;

    const wf = defineWorkflow({
      name: `adv-missing-comp-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        handlerPasses++;

        let options: { compensate: () => Promise<void> } | undefined = {
          compensate: async () => {
            order.push("undo");
          },
        };

        if (handlerPasses >= 4) {
          options = undefined;
        }

        await step(
          "a",
          async () => {
            order.push("a");
            return 1;
          },
          options,
        );

        throw new Error("boom");
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe(
      "compensation handlers missing after CompensationStarted",
    );
    expect(order).toEqual(["a"]);
    expect(order).not.toContain("undo");

    await stop(wf);
  });

  test("CompensationStarted without stepIds does not stick compensating", async () => {
    const redis = createRedis();
    const order: string[] = [];
    let hang = true;

    const name = `adv-legacy-stepids-${crypto.randomUUID()}`;

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "a",
          async () => {
            order.push("a");
            return 1;
          },
          {
            compensate: async () => {
              order.push("undo");

              while (hang) {
                await sleep(10);
              }
            },
          },
        );

        throw new Error("boom");
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "compensating");
    await waitFor(() => order.includes("undo"));

    const historyKey = `workflow:${name}:history:${executionId}`;
    const raw = await redis.lrange(historyKey, 0, -1);
    await redis.del(historyKey);

    for (const entry of raw) {
      const event = JSON.parse(entry) as { type: string; stepIds?: string[] };

      if (event.type === "CompensationStarted") {
        delete event.stepIds;
      }

      await redis.rpush(historyKey, JSON.stringify(event));
    }

    hang = false;

    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe(
      "compensation handlers missing after CompensationStarted",
    );
    expect(order).toEqual(["a", "undo"]);

    await stop(wf);
  });

  test("missing sibling compensate after partial unwind fail closed", async () => {
    const redis = createRedis();
    const order: string[] = [];
    let hangB = true;
    let dropA = false;

    const wf = defineWorkflow({
      name: `adv-sibling-missing-comp-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        let aOptions: { compensate: () => Promise<void> } | undefined = {
          compensate: async () => {
            order.push("undo-a");
          },
        };

        if (dropA) {
          aOptions = undefined;
        }

        await step(
          "a",
          async () => {
            order.push("a");
            return 1;
          },
          aOptions,
        );

        await step(
          "b",
          async () => {
            order.push("b");
            return 2;
          },
          {
            compensate: async () => {
              order.push("undo-b");

              while (hangB) {
                await sleep(10);
              }
            },
          },
        );

        throw new Error("boom");
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "compensating");

    await waitFor(() => order.includes("undo-b"));

    dropA = true;
    hangB = false;

    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe(
      "compensation handlers missing after CompensationStarted",
    );
    expect(order).toEqual(["a", "b", "undo-b"]);
    expect(order).not.toContain("undo-a");

    await stop(wf);
  });

  test("compensate added after CompensationStarted is not run", async () => {
    const redis = createRedis();
    const order: string[] = [];
    let hangA = true;
    let compensateB = false;

    const wf = defineWorkflow({
      name: `adv-extra-comp-after-start-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "a",
          async () => {
            order.push("a");
            return 1;
          },
          {
            compensate: async () => {
              order.push("undo-a");

              while (hangA) {
                await sleep(10);
              }
            },
          },
        );

        let bOptions: { compensate: () => Promise<void> } | undefined;

        if (compensateB) {
          bOptions = {
            compensate: async () => {
              order.push("undo-b");
            },
          };
        }

        await step(
          "b",
          async () => {
            order.push("b");
            return 2;
          },
          bOptions,
        );

        throw new Error("boom");
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "compensating");
    await waitFor(() => order.includes("undo-a"));

    compensateB = true;
    hangA = false;

    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe("boom");
    expect(order).toEqual(["a", "b", "undo-a"]);
    expect(order).not.toContain("undo-b");

    await stop(wf);
  });

  test("corrupt CompensationStarted.stepIds empty array fails closed", async () => {
    const redis = createRedis();
    const order: string[] = [];
    let hangB = true;
    const name = `adv-empty-stepids-${crypto.randomUUID()}`;

    const make = () =>
      defineWorkflow({
        name,
        redis,
        ...fast,
        retries: 0,
        lockTTL: 60,
        handler: async ({ step }) => {
          await step(
            "a",
            async () => {
              order.push("a");
              return 1;
            },
            {
              compensate: async () => {
                order.push("undo-a");
              },
            },
          );

          await step(
            "b",
            async () => {
              order.push("b");
              return 2;
            },
            {
              compensate: async () => {
                order.push("undo-b");

                while (hangB) {
                  await sleep(10);
                }

                throw new Error("reclaim me");
              },
            },
          );

          throw new Error("boom");
        },
      });

    const wf1 = make();
    const { executionId } = await wf1.start({});
    await waitStatus(wf1, executionId, "compensating");
    await waitFor(() => order.includes("undo-b"));

    const historyKey = `workflow:${name}:history:${executionId}`;
    const raw = await redis.lrange(historyKey, 0, -1);
    await redis.del(historyKey);

    for (const entry of raw) {
      const event = JSON.parse(entry) as { type: string; stepIds?: string[] };

      if (event.type === "CompensationStarted") {
        event.stepIds = [];
      }

      await redis.rpush(historyKey, JSON.stringify(event));
    }

    expireLeases(redis);
    hangB = false;
    await stop(wf1);

    const wf2 = make();
    const execution = await waitStatus(wf2, executionId, "failed");

    expect(execution.error).toBe(
      "compensation handlers missing after CompensationStarted",
    );
    expect(order).toContain("undo-b");
    expect(order).not.toContain("undo-a");

    await stop(wf2);
  });

  test("corrupt CompensationStarted.stepIds with phantom id fails closed", async () => {
    const redis = createRedis();
    const order: string[] = [];
    let hang = true;
    const name = `adv-phantom-stepids-${crypto.randomUUID()}`;

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "a",
          async () => {
            order.push("a");
            return 1;
          },
          {
            compensate: async () => {
              order.push("undo-a");

              while (hang) {
                await sleep(10);
              }
            },
          },
        );

        throw new Error("boom");
      },
    });

    const { executionId } = await wf.start({});
    await waitStatus(wf, executionId, "compensating");
    await waitFor(() => order.includes("undo-a"));

    const historyKey = `workflow:${name}:history:${executionId}`;
    const raw = await redis.lrange(historyKey, 0, -1);
    await redis.del(historyKey);

    for (const entry of raw) {
      const event = JSON.parse(entry) as { type: string; stepIds?: string[] };

      if (event.type === "CompensationStarted") {
        event.stepIds = ["ghost99"];
      }

      await redis.rpush(historyKey, JSON.stringify(event));
    }

    hang = false;

    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toBe(
      "compensation handlers missing after CompensationStarted",
    );

    await stop(wf);
  });

  test("corrupt StepCompleted result before collect skips partial unwind", async () => {
    const redis = createRedis();
    const order: string[] = [];
    const name = `adv-corrupt-result-${crypto.randomUUID()}`;
    let releaseFail: (() => void) | undefined;
    const failGate = new Promise<void>((resolve) => {
      releaseFail = resolve;
    });

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "a",
          async () => {
            order.push("a");
            return { id: 1 };
          },
          {
            compensate: async () => {
              order.push("undo-a");
            },
          },
        );

        await step(
          "b",
          async () => {
            order.push("b");
            return { id: 2 };
          },
          {
            compensate: async () => {
              order.push("undo-b");
            },
          },
        );

        await step("gate", async ({ fail }) => {
          await failGate;
          fail(new Error("boom"));
        });
      },
    });

    const { executionId } = await wf.start({});

    await waitFor(async () => {
      const execution = await wf.get(executionId);
      return (
        execution.steps.some((s) => s.name === "a") &&
        execution.steps.some((s) => s.name === "b")
      );
    });

    const historyKey = `workflow:${name}:history:${executionId}`;
    const raw = await redis.lrange(historyKey, 0, -1);
    await redis.del(historyKey);

    for (const entry of raw) {
      const event = JSON.parse(entry) as {
        type: string;
        stepName?: string;
        result?: string;
      };

      if (event.type === "StepCompleted") {
        if (event.stepName === "a") {
          event.result = "{not-json";
        }
      }

      await redis.rpush(historyKey, JSON.stringify(event));
    }

    releaseFail?.();

    const execution = await waitStatus(wf, executionId, "failed");

    expect(execution.error).toMatch(/Unable to deserialize step a|boom/);
    expect(order).not.toContain("undo-a");
    expect(order).not.toContain("undo-b");

    await stop(wf);
  });

  test("delete StepCompleted event before collect skips partial unwind", async () => {
    const redis = createRedis();
    const order: string[] = [];
    const name = `adv-missing-result-${crypto.randomUUID()}`;
    let releaseFail: (() => void) | undefined;
    const failGate = new Promise<void>((resolve) => {
      releaseFail = resolve;
    });

    const wf = defineWorkflow({
      name,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "a",
          async () => {
            order.push("a");
            return 1;
          },
          {
            compensate: async () => {
              order.push("undo-a");
            },
          },
        );

        await step(
          "b",
          async () => {
            order.push("b");
            return 2;
          },
          {
            compensate: async () => {
              order.push("undo-b");
            },
          },
        );

        await step("gate", async ({ fail }) => {
          await failGate;
          fail(new Error("boom"));
        });
      },
    });

    const { executionId } = await wf.start({});

    await waitFor(async () => {
      const execution = await wf.get(executionId);
      return (
        execution.steps.some((s) => s.name === "a") &&
        execution.steps.some((s) => s.name === "b")
      );
    });

    const historyKey = `workflow:${name}:history:${executionId}`;
    const raw = await redis.lrange(historyKey, 0, -1);
    await redis.del(historyKey);

    for (const entry of raw) {
      const event = JSON.parse(entry) as {
        type: string;
        stepName?: string;
      };

      if (event.type === "StepCompleted") {
        if (event.stepName === "a") {
          continue;
        }
      }

      await redis.rpush(historyKey, JSON.stringify(event));
    }

    releaseFail?.();

    const execution = await waitStatus(wf, executionId, "failed");

    expect(order).not.toContain("undo-a");
    expect(order).not.toContain("undo-b");
    expect(execution.error).toBe("boom");

    await stop(wf);
  });

  test("cancel during compensate retry backoff still ends failed with compensate error", async () => {
    const redis = createRedis();
    let attempts = 0;
    let onCancelCalls = 0;

    const wf = defineWorkflow({
      name: `adv-cancel-comp-backoff-${crypto.randomUUID()}`,
      redis,
      pollInterval: 5,
      lockTTL: 40,
      retries: 2,
      retryBackoff: { baseDelay: 50, multiplier: 1, maxDelay: 50 },
      hooks: {
        onCancel: () => {
          onCancelCalls++;
        },
      },
      handler: async ({ step }) => {
        await step("create", async () => 1, {
          compensate: async () => {
            attempts++;
            throw new Error("undo busy");
          },
        });

        throw new Error("forward");
      },
    });

    const { executionId } = await wf.start({});

    await waitFor(() => attempts >= 1);
    await wf.cancel(executionId);

    const execution = await waitStatus(wf, executionId, "failed", 8000);

    expect(attempts).toBe(3);
    expect(execution.error).toBe("undo busy");
    expect(onCancelCalls).toBe(0);

    await stop(wf);
  });

  test("cancel races with forward fail near hang step", async () => {
    const redis = createRedis();
    const order: string[] = [];
    let releaseHang: (() => void) | undefined;
    const hangPromise = new Promise<void>((resolve) => {
      releaseHang = resolve;
    });

    const wf = defineWorkflow({
      name: `adv-cancel-fail-race-${crypto.randomUUID()}`,
      redis,
      ...fast,
      retries: 0,
      handler: async ({ step }) => {
        await step(
          "a",
          async () => {
            order.push("a");
            return 1;
          },
          {
            compensate: async () => {
              order.push("undo-a");
            },
          },
        );

        await step("hang", async ({ fail }) => {
          order.push("hang");
          await hangPromise;
          fail(new Error("race fail"));
        });
      },
    });

    const { executionId } = await wf.start({});
    await waitFor(() => order.includes("hang"));

    await Promise.all([
      wf.cancel(executionId),
      Promise.resolve(releaseHang?.()),
    ]);

    const execution = await waitFor(async () => {
      const current = await wf.get(executionId);
      return current.status === "cancelled" || current.status === "failed";
    }).then(() => wf.get(executionId));

    expect(["cancelled", "failed"]).toContain(execution.status);
    expect(order).toContain("undo-a");
    expect(order.filter((x) => x === "undo-a").length).toBe(1);

    await stop(wf);
  });

  test("onError errorHistory lists each CompensationFailed attempt message", async () => {
    const redis = createRedis();
    const histories: string[][] = [];
    let attempts = 0;

    const wf = defineWorkflow({
      name: `adv-onerror-hist-${crypto.randomUUID()}`,
      redis,
      pollInterval: 5,
      lockTTL: 40,
      retries: 2,
      retryBackoff: { baseDelay: 5, multiplier: 1, maxDelay: 5 },
      hooks: {
        onError: ({ stepName, errorHistory }) => {
          if (stepName === "create") {
            histories.push(errorHistory.map((entry) => entry.error));
          }
        },
      },
      handler: async ({ step }) => {
        await step("create", async () => 1, {
          compensate: async () => {
            attempts++;
            throw new Error(`undo fail ${attempts}`);
          },
        });

        await step("later", async ({ fail }) => {
          fail(new Error("original"));
        });
      },
    });

    const { executionId } = await wf.start({});
    const execution = await waitStatus(wf, executionId, "failed", 8000);

    expect(attempts).toBe(3);
    expect(execution.error).toBe("undo fail 3");
    expect(histories.length).toBe(1);
    expect(histories[0]).toEqual(["undo fail 1", "undo fail 2", "undo fail 3"]);

    await stop(wf);
  });
});
