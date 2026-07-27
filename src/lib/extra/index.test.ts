import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import { mightThrow, mightThrowSync } from "../errors/index.js";
import { InvalidResultError, InvalidRetryError } from "./errors.js";
import { createRetry } from "./index.js";
import type { ErrorClassType, OnFailedAttemptContextType } from "./types.js";

class UserDefinedError extends Error {}
class SpecificError extends UserDefinedError {}

const instantTimeout = ((fn: () => void) => {
  fn();

  return 0;
}) as unknown as typeof setTimeout;

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

describe("Create retry", () => {
  test("should create a callable object", () => {
    const callable = createRetry({ input: () => {}, maxRetries: 1 });
    expect(callable).toBeDefined();
    expect(callable).toBeFunction();
  });

  test("should successfully call onError() callback", async () => {
    const callable = createRetry({
      input: () => {
        throw new Error("A generic error");
      },
      maxRetries: 0,
      id: "1",
      onError: ({ error, failedAt, id }) => {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe("A generic error");
        expect(failedAt).toBe(Date.now());
        expect(id).toBe("1");
      },
    });

    const result = await callable();
    expect(result).toBeUndefined();
  });

  test("should throw an error when onError() callback is not provided", async () => {
    const callable = createRetry({
      input: () => {
        throw new Error("A generic error");
      },
      maxRetries: 0,
    });

    const [error] = await mightThrow(callable());
    expect(error).not.toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe("A generic error");
  });

  test("should successfully call onFailedAttempt() callback", async () => {
    const attempts: OnFailedAttemptContextType[] = [];
    const callable = createRetry({
      input: () => {
        throw new Error("A generic error");
      },
      maxRetries: 3,
      onFailedAttempt: (ctx) => {
        attempts.push(ctx);
      },
    });

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
    const callable = createRetry({
      input: () => {
        if (counter === 1) {
          counter++;
          throw new Error("A generic error");
        }

        if (counter === 2) {
          throw new UserDefinedError("User error");
        }
      },
      maxRetries: 3,
      retryOnError: ({ error }) => !(error instanceof UserDefinedError),
      onFailedAttempt: (ctx) => {
        attempts.push(ctx);
      },
    });

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
    const callable = createRetry({
      input: () => {
        if (counter === 1) {
          counter++;
          throw new Error("A generic error");
        }

        if (counter === 2) {
          throw new UserDefinedError("User error");
        }
      },
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
    });

    await mightThrow(callable());

    expect(attempts).toBeArrayOfSize(1);
    expect(attempts[0]?.attemptNumber).toBe(1);
    expect(attempts[0]?.retriesLeft).toBe(3);
  });

  test("should return a value after some failed attempts", async () => {
    let counter = 0;
    const attempts: OnFailedAttemptContextType[] = [];

    const callable = createRetry({
      input: () => {
        if (counter <= 2) {
          throw new Error("A generic error");
        }

        return "success";
      },
      maxRetries: 4,
      onFailedAttempt: (ctx) => {
        attempts.push(ctx);
        counter++;
      },
    });

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

    const callable = createRetry({
      input: () => {
        throw new Error("A repeating error");
      },
      maxRetries: 2,
      onFailedAttempt: (ctx) => {
        if (!secondCall) {
          attemptsOnFirstCall.push(ctx);
        } else {
          attemptsOnSecondCall.push(ctx);
        }
      },
    });

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

  test("should rethrow original error when onFailedAttempt() throws", async () => {
    const original = new Error("A generic error");
    const callable = createRetry({
      input: () => {
        throw original;
      },
      maxRetries: 2,
      onFailedAttempt: () => {
        throw new Error("callback failed");
      },
    });

    const [error] = await mightThrow(callable());
    expect(error).toBe(original);
  });

  test("should rethrow original error when onError() throws", async () => {
    const original = new Error("A generic error");
    const callable = createRetry({
      input: () => {
        throw original;
      },
      maxRetries: 0,
      onError: () => {
        throw new Error("callback failed");
      },
    });

    const [error] = await mightThrow(callable());
    expect(error).toBe(original);
  });
});

describe("Validate attempts", () => {
  const noop = () => {};

  test("should raise an error when passing a negative number", () => {
    const [retryNegativeNumber] = mightThrowSync(() =>
      createRetry({ input: noop, maxRetries: -10 }),
    );

    expect(retryNegativeNumber).toBeDefined();
    expect(retryNegativeNumber).toBeInstanceOf(InvalidRetryError);

    const [retryNegativeZero] = mightThrowSync(() =>
      createRetry({ input: noop, maxRetries: -0 }),
    );

    expect(retryNegativeZero).toBeDefined();
    expect(retryNegativeZero).toBeInstanceOf(InvalidRetryError);

    const [retryNegativeInfinity] = mightThrowSync(() =>
      createRetry({
        input: noop,
        maxRetries: Number.NEGATIVE_INFINITY,
      }),
    );

    expect(retryNegativeInfinity).toBeDefined();
    expect(retryNegativeInfinity).toBeInstanceOf(InvalidRetryError);

    const [secondRetryNegativeInfinity] = mightThrowSync(() =>
      createRetry({
        input: noop,
        maxRetries: -Infinity,
      }),
    );

    expect(secondRetryNegativeInfinity).toBeDefined();
    expect(secondRetryNegativeInfinity).toBeInstanceOf(InvalidRetryError);
  });

  test("should raise an error when passing NaN", () => {
    const [retryNan] = mightThrowSync(() =>
      createRetry({ input: noop, maxRetries: NaN }),
    );

    expect(retryNan).toBeDefined();
    expect(retryNan).toBeInstanceOf(InvalidRetryError);
  });

  test("should raise an error when passing a non-integer number", () => {
    const [decimalNumberRetry] = mightThrowSync(() =>
      createRetry({ input: noop, maxRetries: 1.5 }),
    );

    expect(decimalNumberRetry).toBeDefined();
    expect(decimalNumberRetry).toBeInstanceOf(InvalidRetryError);

    const [negativeDecimalNumberRetry] = mightThrowSync(() =>
      createRetry({ input: noop, maxRetries: -1.5 }),
    );

    expect(negativeDecimalNumberRetry).toBeDefined();
    expect(negativeDecimalNumberRetry).toBeInstanceOf(InvalidRetryError);
  });

  test("should not raise an error when passing a floating point number that can be represented as integer", () => {
    const [integerDecimalNumberRetry] = mightThrowSync(() =>
      createRetry({ input: noop, maxRetries: 5.0 }),
    );

    expect(integerDecimalNumberRetry).toBeNull();
  });

  test("should raise an error when passing 'Infinity'", () => {
    const [infinityRetry] = mightThrowSync(() =>
      createRetry({ input: noop, maxRetries: Number.POSITIVE_INFINITY }),
    );

    expect(infinityRetry).toBeDefined();
    expect(infinityRetry).toBeInstanceOf(InvalidRetryError);

    const [secondInfinityRetry] = mightThrowSync(() =>
      createRetry({ input: noop, maxRetries: Infinity }),
    );

    expect(secondInfinityRetry).toBeDefined();
    expect(secondInfinityRetry).toBeInstanceOf(InvalidRetryError);
  });
});

describe("Ignoring Errors", () => {
  test("should ignore base error classe", async () => {
    const callable = createRetry({
      input: () => {
        throw new Error("Ignored generic error");
      },
      maxRetries: 3,
      ignoreErrors: [Error],
    });

    const [error] = await mightThrow(callable());
    expect(error).not.toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe("Ignored generic error");
  });

  test("should ignore base error classes and subclasses", async () => {
    let state = 0;
    const callable = createRetry({
      input: () => {
        if (state === 0) {
          state++;
          throw new Error("Ignored generic error");
        }

        if (state === 1) {
          state++;
          throw new RangeError("Ignored range error");
        }

        if (state === 2) {
          throw new TypeError("Ignored type error");
        }
      },
      maxRetries: 3,
      ignoreErrors: [Error, TypeError, RangeError],
    });

    const [genericError] = await mightThrow(callable());
    expect(genericError).not.toBeNull();
    expect(genericError).toBeInstanceOf(Error);
    expect(genericError?.message).toBe("Ignored generic error");

    const [rangeError] = await mightThrow(callable());
    expect(rangeError).not.toBeNull();
    expect(rangeError).toBeInstanceOf(RangeError);
    expect(rangeError?.message).toBe("Ignored range error");

    const [typeError] = await mightThrow(callable());
    expect(typeError).not.toBeNull();
    expect(typeError).toBeInstanceOf(TypeError);
    expect(typeError?.message).toBe("Ignored type error");
  });

  test("should ignore both custom classes and subclasses errors", async () => {
    let state = 0;
    const callable = createRetry({
      input: () => {
        if (state === 0) {
          state++;
          throw new UserDefinedError("base user defined error class");
        }

        if (state === 1) {
          throw new SpecificError("child user defined error class");
        }
      },
      maxRetries: 3,
      ignoreErrors: [UserDefinedError, SpecificError],
    });

    const [userDefinedError] = await mightThrow(callable());
    expect(userDefinedError).not.toBeNull();
    expect(userDefinedError).toBeInstanceOf(UserDefinedError);
    expect(userDefinedError?.message).toBe("base user defined error class");

    const [specificError] = await mightThrow(callable());
    expect(specificError).not.toBeNull();
    expect(specificError).toBeInstanceOf(SpecificError);
    expect(specificError?.message).toBe("child user defined error class");
  });

  test("should ignore both custom and base errors", async () => {
    let state = 0;
    const callable = createRetry({
      input: () => {
        if (state === 0) {
          state++;
          throw new UserDefinedError("base user defined error class");
        }

        if (state === 1) {
          state++;
          throw new TypeError("type error");
        }

        if (state === 2) {
          state++;
          throw new Error("generic error");
        }
      },
      maxRetries: 3,
      ignoreErrors: [Error, UserDefinedError, TypeError],
    });

    const [userDefinedError] = await mightThrow(callable());
    expect(userDefinedError).not.toBeNull();
    expect(userDefinedError).toBeInstanceOf(UserDefinedError);
    expect(userDefinedError?.message).toBe("base user defined error class");

    const [typeError] = await mightThrow(callable());
    expect(typeError).not.toBeNull();
    expect(typeError).toBeInstanceOf(TypeError);
    expect(typeError?.message).toBe("type error");

    const [genericError] = await mightThrow(callable());
    expect(genericError).not.toBeNull();
    expect(genericError).toBeInstanceOf(Error);
    expect(genericError?.message).toBe("generic error");
  });

  test("should retry on a specific error", async () => {
    let state = 0;
    let called = 0;
    const callable = createRetry({
      input: () => {
        if (state === 0) {
          state++;
          throw new UserDefinedError("base user defined error class");
        }

        if (state === 1) {
          state++;
          throw new SpecificError("child user defined error class");
        }

        if (state === 2) {
          state = 0;
          throw new TypeError("invalid type");
        }
      },
      maxRetries: 3,
      ignoreErrors: [UserDefinedError, SpecificError],
      onFailedAttempt: ({ retriesLeft, attemptNumber }) => {
        called++;
        expect(attemptNumber).toBe(1);
        expect(retriesLeft).toBe(2);
      },
    });

    const [userDefinedError] = await mightThrow(callable());
    expect(userDefinedError).not.toBeNull();
    expect(userDefinedError).toBeInstanceOf(UserDefinedError);
    expect(userDefinedError?.message).toBe("base user defined error class");

    const [specificError] = await mightThrow(callable());
    expect(specificError).not.toBeNull();
    expect(specificError).toBeInstanceOf(SpecificError);
    expect(specificError?.message).toBe("child user defined error class");

    const _ = await mightThrow(callable());
    expect(called).toBe(1);
  });
});

describe("Retriable Errors", () => {
  test("should retry on every errors", async () => {
    const errorsTypes: ErrorClassType<Error>[] = [Error, RangeError, TypeError];
    const messages = ["generic error", "range error", "type error"];
    let state = 0;
    let idx = 0;

    const callable = createRetry({
      input: () => {
        if (state === 0) {
          state++;
          throw new Error(messages[0]);
        }

        if (state === 1) {
          state++;
          throw new RangeError(messages[1]);
        }

        if (state === 2) {
          state = 0;
          throw new TypeError(messages[2]);
        }
      },
      maxRetries: 3,
      onFailedAttempt: ({ error }) => {
        const errType = errorsTypes[idx];
        const message = messages[idx];
        if (!errType) return;
        if (!message) return;

        expect(error.constructor).toBe(errType);
        expect(error?.message).toBe(message);
        idx++;
      },
    });

    await mightThrow(callable());
    expect(idx).toBe(3);
  });

  test("should retry only over a strict subset of errors", async () => {
    const errorsTypes: ErrorClassType<Error>[] = [RangeError, TypeError];
    const messages = ["range error", "type error"];
    let state = 0;
    let idx = 0;

    const callable = createRetry({
      input: () => {
        if (state === 0) {
          state++;
          throw new RangeError(messages[0]);
        }

        if (state === 1) {
          state++;
          throw new TypeError(messages[1]);
        }

        if (state === 2) {
          state = 0;
          throw new Error("do not retry");
        }
      },
      maxRetries: 3,
      retryErrors: [RangeError, TypeError],
      onFailedAttempt: ({ error }) => {
        const errType = errorsTypes[idx];
        const message = messages[idx];
        if (!errType) return;
        if (!message) return;

        expect(error.constructor).toBe(errType);
        expect(error?.message).toBe(message);
        idx++;
      },
    });

    const [error] = await mightThrow(callable());
    expect(error).not.toBeNull();
    expect(error?.constructor).toBe(Error);
    expect(error?.message).toBe("do not retry");
    expect(idx).toBe(2);
  });

  test("should retry only over user provided errors", async () => {
    const errorsTypes: ErrorClassType<Error>[] = [
      UserDefinedError,
      SpecificError,
    ];
    const messages = ["user error", "specific error"];
    let state = 0;
    let idx = 0;

    const callable = createRetry({
      input: () => {
        if (state === 0) {
          state++;
          throw new UserDefinedError(messages[0]);
        }

        if (state === 1) {
          state++;
          throw new SpecificError(messages[1]);
        }

        if (state === 2) {
          state = 0;
          throw new TypeError("do not retry");
        }
      },
      maxRetries: 3,
      retryErrors: [UserDefinedError, SpecificError],
      onFailedAttempt: ({ error }) => {
        const errType = errorsTypes[idx];
        const message = messages[idx];
        if (!errType) return;
        if (!message) return;

        expect(error.constructor).toBe(errType);
        expect(error?.message).toBe(message);
        idx++;
      },
    });

    const [error] = await mightThrow(callable());
    expect(error).not.toBeNull();
    expect(error?.constructor).toBe(TypeError);
    expect(error?.message).toBe("do not retry");
    expect(idx).toBe(2);
  });

  test("should ignore a specific error and retry over other errors", async () => {
    const errorsTypes: ErrorClassType<Error>[] = [
      UserDefinedError,
      SpecificError,
    ];

    const messages = ["user error", "specific error"];
    let state = 0;
    let idx = 0;

    const callable = createRetry({
      input: () => {
        if (state === 0) {
          state++;
          throw new UserDefinedError(messages[0]);
        }

        if (state === 1) {
          state++;
          throw new SpecificError(messages[1]);
        }

        if (state === 2) {
          state = 0;
          throw new TypeError("ignore TypeError");
        }
      },
      maxRetries: 3,
      retryErrors: [UserDefinedError, SpecificError],
      ignoreErrors: [TypeError],
      onFailedAttempt: ({ error }) => {
        const errType = errorsTypes[idx];
        const message = messages[idx];
        if (!errType) return;
        if (!message) return;

        expect(error.constructor).toBe(errType);
        expect(error?.message).toBe(message);
        idx++;
      },
    });

    const [error] = await mightThrow(callable());
    expect(error).not.toBeNull();
    expect(error?.constructor).toBe(TypeError);
    expect(error?.message).toBe("ignore TypeError");
    expect(idx).toBe(2);
  });

  test("should ignore a specific error and stop the execution of the function", async () => {
    const errorsTypes: ErrorClassType<Error>[] = [
      UserDefinedError,
      SpecificError,
    ];

    const messages = ["user error", "specific error"];
    let state = 0;
    let idx = 0;

    const callable = createRetry({
      input: () => {
        if (state === 0) {
          state++;
          throw new UserDefinedError(messages[0]);
        }

        if (state === 1) {
          state++;
          throw new TypeError("ignore TypeError");
        }

        if (state === 2) {
          state = 0;
          throw new SpecificError(messages[1]);
        }
      },
      maxRetries: 3,
      retryErrors: [UserDefinedError, SpecificError],
      ignoreErrors: [TypeError],
      onFailedAttempt: ({ error }) => {
        const errType = errorsTypes[idx];
        const message = messages[idx];
        if (!errType) return;
        if (!message) return;

        expect(error.constructor).toBe(errType);
        expect(error?.message).toBe(message);
        idx++;
      },
    });

    const [error] = await mightThrow(callable());
    expect(error).not.toBeNull();
    expect(error?.constructor).toBe(TypeError);
    expect(error?.message).toBe("ignore TypeError");
    expect(idx).toBe(1);
  });
});

describe("Retry on results", () => {
  test("should skip retries when retryOnResult() is not provided", async () => {
    const callable = createRetry({
      input: () => {
        return "success";
      },
      maxRetries: 4,
    });

    const result = await callable();
    expect(result).not.toBeUndefined();
    expect(result).toBeTypeOf("string");
    expect(result).toBe("success");
  });

  test("should retry on failed result", async () => {
    let onFailedCalles = 0;
    const callable = createRetry({
      input: () => {
        return new Response(undefined, { status: 404 });
      },
      retryOnResult: (res) => res.status === 404,
      onFailedAttempt: () => {
        onFailedCalles++;
      },
      maxRetries: 4,
    });

    const [error, result] = await mightThrow(callable());
    expect(result).toBeNull();
    expect(error).not.toBeNull();
    expect(error).toBeInstanceOf(InvalidResultError);
    expect(onFailedCalles).toBe(4);
  });

  test("should ignore result's error", async () => {
    let onFailedCalles = 0;

    const callable = createRetry({
      input: () => {
        return new Response(undefined, { status: 404 });
      },
      retryOnResult: (res) => res.status === 404,
      onFailedAttempt: () => {
        onFailedCalles++;
      },
      ignoreErrors: [InvalidResultError],
      maxRetries: 4,
    });

    const [error, result] = await mightThrow(callable());
    expect(result).toBeNull();
    expect(error).not.toBeNull();
    expect(error).toBeInstanceOf(InvalidResultError);
    expect(onFailedCalles).toBe(0);
  });

  test("'retryErrors' should not influence 'retryOnResult()' execution", async () => {
    let onFailedCalles = 0;

    const callable = createRetry({
      input: () => {
        return new Response(undefined, { status: 404 });
      },
      retryOnResult: (res) => res.status === 404,
      onFailedAttempt: () => {
        onFailedCalles++;
      },
      retryErrors: [InvalidResultError],
      maxRetries: 4,
    });

    const [error, result] = await mightThrow(callable());
    expect(result).toBeNull();
    expect(error).not.toBeNull();
    expect(error).toBeInstanceOf(InvalidResultError);
    expect(onFailedCalles).toBe(4);
  });

  test("'retryOnError()' should not influence 'retryOnResult()' execution when the former return true", async () => {
    let onFailedCalles = 0;

    const callable = createRetry({
      input: () => {
        return new Response(undefined, { status: 404 });
      },
      retryOnResult: (res) => res.status === 404,
      retryOnError: ({ error }) => error instanceof InvalidResultError,
      onFailedAttempt: () => {
        onFailedCalles++;
      },
      maxRetries: 4,
    });

    const [error, result] = await mightThrow(callable());
    expect(result).toBeNull();
    expect(error).not.toBeNull();
    expect(error).toBeInstanceOf(InvalidResultError);
    expect(onFailedCalles).toBe(4);
  });

  test("should not retry if 'retryOnError()' return false", async () => {
    let onFailedCalles = 0;

    const callable = createRetry({
      input: () => {
        return new Response(undefined, { status: 404 });
      },
      retryOnResult: (res) => res.status === 404,
      retryOnError: ({ error }) => !(error instanceof InvalidResultError),
      onFailedAttempt: () => {
        onFailedCalles++;
      },
      maxRetries: 4,
    });

    const [error, result] = await mightThrow(callable());
    expect(result).toBeNull();
    expect(error).not.toBeNull();
    expect(error).toBeInstanceOf(InvalidResultError);
    expect(onFailedCalles).toBe(0);
  });

  test("should call onError() over invalid results", async () => {
    let onErrorCalled = 0;
    const callable = createRetry({
      input: () => {
        return new Response(undefined, { status: 404 });
      },
      retryOnResult: (res) => res.status === 404,
      onError: ({ error, failedAt, id }) => {
        expect(error).toBeInstanceOf(InvalidResultError);
        expect(failedAt).toBe(Date.now());
        expect(id).toBe("1");

        onErrorCalled++;
      },
      maxRetries: 4,
      id: "1",
    });

    const [error, result] = await mightThrow(callable());
    expect(result).toBeUndefined();
    expect(error).toBeNull();
    expect(onErrorCalled).toBe(1);
  });

  test("should call onFailedAttempt() when retring over an invalid result", async () => {
    const failsData: {
      error: Error;
      attemptNumber: number;
      retriesLeft: number;
    }[] = [];

    let onFailedCalles = 0;
    const callable = createRetry({
      input: () => {
        return new Response(undefined, { status: 404 });
      },
      retryOnResult: (res) => res.status === 404,
      onFailedAttempt: ({ error, attemptNumber, retriesLeft }) => {
        onFailedCalles++;
        failsData.push({ error, attemptNumber, retriesLeft });
      },
      maxRetries: 2,
    });

    const [error, result] = await mightThrow(callable());
    expect(result).toBeNull();
    expect(error).not.toBeNull();
    expect(error).toBeInstanceOf(InvalidResultError);
    expect(onFailedCalles).toBe(2);

    expect(failsData).toHaveLength(2);
    expect(failsData[0]?.error).toBeInstanceOf(InvalidResultError);
    expect(failsData[1]?.error).toBeInstanceOf(InvalidResultError);

    expect(failsData[0]?.attemptNumber).toBe(1);
    expect(failsData[1]?.attemptNumber).toBe(2);

    expect(failsData[0]?.retriesLeft).toBe(2);
    expect(failsData[1]?.retriesLeft).toBe(1);
  });
});
