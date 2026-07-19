import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import { mightThrow } from "../errors/index.js";
import { createRetry, InvalidRetryError } from "./index.js";
import type { OnFailedAttemptContextType } from "./types.js";

class UserDefinedError extends Error {}

const instantTimeout = ((fn: () => void) => {
  fn();

  return 0;
}) as unknown as typeof setTimeout;

describe("Create retry", () => {
  let timeoutSpy: ReturnType<typeof spyOn<typeof globalThis, "setTimeout">>;

  beforeEach(() => {
    setSystemTime(new Date("2020-01-10T00:00:00.000Z"));
    timeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(
      instantTimeout,
    );
  });

  afterEach(() => {
    setSystemTime();
    timeoutSpy.mockRestore();
  });

  test("should create a callable object", () => {
    const callable = createRetry(() => {}, { maxRetries: 1 });
    expect(callable).toBeDefined();
    expect(callable).toBeFunction();
  });

  test("should successfully call onError() callback", async () => {
    const callable = createRetry(
      () => {
        throw new Error("A generic error");
      },
      {
        maxRetries: 0,
        id: "1",
        onError: ({ error, failedAt, id }) => {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBe("A generic error");
          expect(failedAt).toBe(Date.now());
          expect(id).toBe("1");
        },
      },
    );

    const result = await callable();
    expect(result).toBeUndefined();
  });

  test("should throw an error when onError() callback is not provided", async () => {
    const callable = createRetry(
      () => {
        throw new Error("A generic error");
      },
      {
        maxRetries: 0,
      },
    );

    const [error] = await mightThrow(callable());
    expect(error).not.toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe("A generic error");
  });

  test("should successfully call onFailedAttempt() callback", async () => {
    const attempts: OnFailedAttemptContextType[] = [];
    const callable = createRetry(
      () => {
        throw new Error("A generic error");
      },
      {
        maxRetries: 3,
        onFailedAttempt: (ctx) => {
          attempts.push(ctx);
        },
      },
    );

    const [err] = await mightThrow(callable());

    expect(attempts).toBeArrayOfSize(3);

    expect(attempts[0]?.attemptNumber).toBe(1);
    expect(attempts[0]?.retriesLeft).toBe(3);

    expect(attempts[1]?.attemptNumber).toBe(2);
    expect(attempts[1]?.retriesLeft).toBe(2);

    expect(attempts[2]?.attemptNumber).toBe(3);
    expect(attempts[2]?.retriesLeft).toBe(1);

    expect(err).not.toBeNull();
    expect(err?.message).toBe("A generic error");
  });

  test("should not retry when retryOnError() callback return false", async () => {
    let counter = 1;
    const attempts: OnFailedAttemptContextType[] = [];
    const callable = createRetry(
      () => {
        if (counter === 1) {
          counter++;
          throw new Error("A generic error");
        }

        if (counter === 2) {
          throw new UserDefinedError("User error");
        }
      },
      {
        maxRetries: 3,
        retryOnError: ({ error }) => !(error instanceof UserDefinedError),
        onFailedAttempt: (ctx) => {
          attempts.push(ctx);
        },
      },
    );

    const [err] = await mightThrow(callable());

    expect(attempts).toBeArrayOfSize(1);

    expect(attempts[0]?.attemptNumber).toBe(1);
    expect(attempts[0]?.retriesLeft).toBe(3);

    expect(err).not.toBeNull();
    expect(err).toBeInstanceOf(UserDefinedError);
    expect(err?.message).toBe("User error");
  });

  test("should not retry when retryOnError() callback return false and also call onError() callback", async () => {
    let counter = 1;
    const attempts: OnFailedAttemptContextType[] = [];
    const callable = createRetry(
      () => {
        if (counter === 1) {
          counter++;
          throw new Error("A generic error");
        }

        if (counter === 2) {
          throw new UserDefinedError("User error");
        }
      },
      {
        id: "1",
        maxRetries: 3,
        retryOnError: ({ error }) => !(error instanceof UserDefinedError),
        onError: ({ error, failedAt, id }) => {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBe("User error");
          expect(failedAt).toBe(Date.now());
          expect(id).toBe("1");
        },
        onFailedAttempt: (ctx) => {
          attempts.push(ctx);
        },
      },
    );

    await mightThrow(callable());

    expect(attempts).toBeArrayOfSize(1);
    expect(attempts[0]?.attemptNumber).toBe(1);
    expect(attempts[0]?.retriesLeft).toBe(3);
  });

  test("should return a value after some failed attempts", async () => {
    let counter = 0;
    const attempts: OnFailedAttemptContextType[] = [];

    const callable = createRetry(
      () => {
        if (counter <= 2) {
          throw new Error("A generic error");
        }

        return "success";
      },
      {
        maxRetries: 4,
        onFailedAttempt: (ctx) => {
          attempts.push(ctx);
          counter++;
        },
      },
    );

    const [error, result] = await mightThrow(callable());
    expect(attempts).toBeArrayOfSize(3);
    expect(attempts[0]?.attemptNumber).toBe(1);
    expect(attempts[0]?.retriesLeft).toBe(4);

    expect(attempts[1]?.attemptNumber).toBe(2);
    expect(attempts[1]?.retriesLeft).toBe(3);

    expect(attempts[2]?.attemptNumber).toBe(3);
    expect(attempts[2]?.retriesLeft).toBe(2);

    expect(error).toBeNull();
    expect(result).not.toBeNull();
    expect(result).toBeTypeOf("string");
    expect(result).toBe("success");
  });

  test("should not duplicate retry state when calling the function multiple times", async () => {
    let secondCall = false;
    const attemptsOnFirstCall: OnFailedAttemptContextType[] = [];
    const attemptsOnSecondCall: OnFailedAttemptContextType[] = [];

    const callable = createRetry(
      () => {
        throw new Error("A repeating error");
      },
      {
        maxRetries: 2,
        onFailedAttempt: (ctx) => {
          if (!secondCall) {
            attemptsOnFirstCall.push(ctx);
          } else {
            attemptsOnSecondCall.push(ctx);
          }
        },
      },
    );

    await mightThrow(callable());
    secondCall = true;
    await mightThrow(callable());

    expect(attemptsOnFirstCall.length).toBe(attemptsOnSecondCall.length);

    expect(attemptsOnFirstCall[0]?.attemptNumber).toBe(
      attemptsOnSecondCall[0]?.attemptNumber,
    );
    expect(attemptsOnFirstCall[0]?.retriesLeft).toBe(
      attemptsOnSecondCall[0]?.retriesLeft,
    );
    expect(attemptsOnFirstCall[0]?.id).not.toBe(attemptsOnSecondCall[0]?.id);

    expect(attemptsOnFirstCall[1]?.attemptNumber).toBe(
      attemptsOnSecondCall[1]?.attemptNumber,
    );
    expect(attemptsOnFirstCall[1]?.retriesLeft).toBe(
      attemptsOnSecondCall[1]?.retriesLeft,
    );
    expect(attemptsOnFirstCall[1]?.id).not.toBe(attemptsOnSecondCall[1]?.id);
  });
});

describe("Validate attempts", () => {
  const noop = () => {};

  test("should raise an error when passing a negative number", async () => {
    const negativeNumberCall = createRetry(noop, { maxRetries: -10 });
    const [retryNegativeNumber] = await mightThrow(negativeNumberCall());
    expect(retryNegativeNumber).toBeDefined();
    expect(retryNegativeNumber).toBeInstanceOf(InvalidRetryError);

    const negativeZeroCall = createRetry(noop, { maxRetries: -0 });
    const [retryNegativeZero] = await mightThrow(negativeZeroCall());
    expect(retryNegativeZero).toBeDefined();
    expect(retryNegativeZero).toBeInstanceOf(InvalidRetryError);

    const negativeInfinityCall = createRetry(noop, {
      maxRetries: Number.NEGATIVE_INFINITY,
    });
    const [retryNegativeInfinity] = await mightThrow(negativeInfinityCall());
    expect(retryNegativeInfinity).toBeDefined();
    expect(retryNegativeInfinity).toBeInstanceOf(InvalidRetryError);

    const secondNegativeInfinityCall = createRetry(noop, {
      maxRetries: -Infinity,
    });
    const [secondRetryNegativeInfinity] = await mightThrow(
      secondNegativeInfinityCall(),
    );
    expect(secondRetryNegativeInfinity).toBeDefined();
    expect(secondRetryNegativeInfinity).toBeInstanceOf(InvalidRetryError);
  });

  test("should raise an error when passing NaN", async () => {
    const nanCall = createRetry(noop, { maxRetries: NaN });
    const [retryNan] = await mightThrow(nanCall());

    expect(retryNan).toBeDefined();
    expect(retryNan).toBeInstanceOf(InvalidRetryError);
  });

  test("should raise an error when passing a non-integer number", async () => {
    const decimalNumberCall = createRetry(noop, { maxRetries: 1.5 });
    const [decimalNumberRetry] = await mightThrow(decimalNumberCall());
    expect(decimalNumberRetry).toBeDefined();
    expect(decimalNumberRetry).toBeInstanceOf(InvalidRetryError);

    const negativeDecimalNumberCall = createRetry(noop, { maxRetries: -1.5 });
    const [negativeDecimalNumberRetry] = await mightThrow(
      negativeDecimalNumberCall(),
    );
    expect(negativeDecimalNumberRetry).toBeDefined();
    expect(negativeDecimalNumberRetry).toBeInstanceOf(InvalidRetryError);
  });

  test("should not raise an error when passing a floating point number that can be represented as integer", async () => {
    const integerDecimalNumberCall = createRetry(noop, { maxRetries: 5.0 });
    const [integerDecimalNumberRetry] = await mightThrow(
      integerDecimalNumberCall(),
    );
    expect(integerDecimalNumberRetry).toBeNull();
  });

  test("should raise an error when passing 'Infinity'", async () => {
    const inifinyCall = createRetry(noop, {
      maxRetries: Number.POSITIVE_INFINITY,
    });
    const [infinityRetry] = await mightThrow(inifinyCall());
    expect(infinityRetry).toBeDefined();
    expect(infinityRetry).toBeInstanceOf(InvalidRetryError);

    const secondInifinyCall = createRetry(noop, {
      maxRetries: Infinity,
    });
    const [secondInfinityRetry] = await mightThrow(secondInifinyCall());
    expect(secondInfinityRetry).toBeDefined();
    expect(secondInfinityRetry).toBeInstanceOf(InvalidRetryError);
  });
});
