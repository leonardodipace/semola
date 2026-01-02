import { describe, expect, test } from "bun:test";
import { err, mightThrow, mightThrowSync, ok } from "./index.js";

describe("Errors Module", () => {
  describe("ok", () => {
    test("should return success tuple with null error", () => {
      const result = ok("success");
      expect(result).toEqual([null, "success"]);
    });

    test("should work with different data types", () => {
      expect(ok(42)).toEqual([null, 42]);
      expect(ok(true)).toEqual([null, true]);
      expect(ok({ key: "value" })).toEqual([null, { key: "value" }]);
      expect(ok(null)).toEqual([null, null]);
    });

    test("should preserve type information", () => {
      const [error, data] = ok("test");
      expect(error).toBeNull();
      expect(data).toBe("test");
    });

    test("should preserve complex type information", () => {
      type Obj = {
        attr: number;
        inner?: Obj;
      }

      const obj: Obj = {
        attr: 1, inner: { attr: 2 }
      }
      const [error, data] = ok(obj);
      expect(error).toBeNull();
      expect(data).toMatchObject(obj);
    });
  });

  describe("err", () => {
    test("should return error tuple with null data", () => {
      const result = err("NotFoundError", "Resource not found");
      expect(result).toEqual([
        { type: "NotFoundError", message: "Resource not found" },
        null,
      ]);
    });

    test("should work with common error types", () => {
      const notFoundError = err("NotFoundError", "Not found");
      expect(notFoundError[0]?.type).toBe("NotFoundError");
      expect(notFoundError[0]?.message).toBe("Not found");

      const unauthorizedError = err("UnauthorizedError", "Unauthorized");
      expect(unauthorizedError[0]?.type).toBe("UnauthorizedError");
      expect(unauthorizedError[0]?.message).toBe("Unauthorized");

      const validationError = err("ValidationError", "Invalid input");
      expect(validationError[0]?.type).toBe("ValidationError");
      expect(validationError[0]?.message).toBe("Invalid input");

      const internalError = err("InternalServerError", "Internal error");
      expect(internalError[0]?.type).toBe("InternalServerError");
      expect(internalError[0]?.message).toBe("Internal error");
    });

    test("should work with custom error types", () => {
      const result = err("CustomError", "Custom error message");
      expect(result[0]?.type).toBe("CustomError");
      expect(result[0]?.message).toBe("Custom error message");
    });
  });

  describe("mightThrowSync", () => {
    test("should return ok tuple when function succeeds", () => {
      const fn = () => "success";
      const [error, data] = mightThrowSync(fn);
      expect(error).toBeNull();
      expect(data).toBe("success");
    });

    test("should return error tuple when function throws", () => {
      const fn = () => {
        throw new Error("Something went wrong");
      };
      const [error, data] = mightThrowSync(fn);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Something went wrong");
      expect(data).toBeNull();
    });

    test("should work with JSON.parse success", () => {
      const [error, data] = mightThrowSync(() => JSON.parse('{"key":"value"}'));
      expect(error).toBeNull();
      expect(data).toEqual({ key: "value" });
    });

    test("should work with JSON.parse failure", () => {
      const [error, data] = mightThrowSync(() => JSON.parse("invalid json"));
      expect(error).toBeInstanceOf(SyntaxError);
      expect(data).toBeNull();
    });

    test("should work with JSON.stringify", () => {
      const obj = { key: "value" };
      const [error, data] = mightThrowSync(() => JSON.stringify(obj));
      expect(error).toBeNull();
      expect(data).toBe('{"key":"value"}');
    });

    test("should handle different error types", () => {
      const fn = () => {
        throw "string error";
      };
      const [error, data] = mightThrowSync(fn);
      expect(error).toBe("string error");
      expect(data).toBeNull();
    });

    test("should work with functions returning different types", () => {
      expect(mightThrowSync(() => 42)).toEqual([null, 42]);
      expect(mightThrowSync(() => true)).toEqual([null, true]);
      expect(mightThrowSync(() => [1, 2, 3])).toEqual([null, [1, 2, 3]]);
    });
  });

  describe("mightThrow", () => {
    test("should return ok tuple when promise resolves", async () => {
      const promise = Promise.resolve("success");
      const [error, data] = await mightThrow(promise);
      expect(error).toBeNull();
      expect(data).toBe("success");
    });

    test("should return error tuple when promise rejects", async () => {
      const promise = Promise.reject(new Error("Promise failed"));
      const [error, data] = await mightThrow(promise);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Promise failed");
      expect(data).toBeNull();
    });

    test("should work with async operations", async () => {
      const asyncFn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "delayed success";
      };
      const [error, data] = await mightThrow(asyncFn());
      expect(error).toBeNull();
      expect(data).toBe("delayed success");
    });

    test("should work with rejected async operations", async () => {
      const asyncFn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error("delayed error");
      };
      const [error, data] = await mightThrow(asyncFn());
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("delayed error");
      expect(data).toBeNull();
    });

    test("should handle different promise resolution types", async () => {
      expect(await mightThrow(Promise.resolve(42))).toEqual([null, 42]);
      expect(await mightThrow(Promise.resolve(true))).toEqual([null, true]);
      expect(await mightThrow(Promise.resolve({ key: "value" }))).toEqual([
        null,
        { key: "value" },
      ]);
    });

    test("should handle multiple promises at the same time", async () => {
      const p1 = Promise.resolve(42);
      const p2 = Promise.resolve(true);
      const p3 = Promise.resolve({ key: "value" });
      const [error, result] = await mightThrow(Promise.all([p1, p2, p3]))

      expect(error).toBeNull();
      expect(result).toBeArray();
      expect(result).toBeArrayOfSize(3);
      expect(result).toEqual([42, true, { key: "value" }]);
    });


    test("should handle different rejection types", async () => {
      const [error1] = await mightThrow(Promise.reject("string error"));
      expect(error1).toBe("string error");

      const [error2] = await mightThrow(Promise.reject(404));
      expect(error2).toBe(404);

      const [error3] = await mightThrow(Promise.reject({ code: "ERROR" }));
      expect(error3).toEqual({ code: "ERROR" });
    });
  });

  describe("Integration patterns", () => {
    test("should work together in error handling flow", async () => {
      const fetchData = async () => {
        const [error, data] = await mightThrow(
          Promise.resolve('{"name":"John"}'),
        );
        if (error || !data) {
          return err("InternalServerError", "Failed to fetch");
        }

        const [parseError, parsed] = mightThrowSync(() => JSON.parse(data));
        if (parseError) {
          return err("ValidationError", "Invalid JSON");
        }

        return ok(parsed);
      };

      const result = await fetchData();
      expect(result).toEqual([null, { name: "John" }]);
    });

    test("should handle nested error scenarios", async () => {
      const processData = async () => {
        const [fetchError, rawData] = await mightThrow(
          Promise.reject(new Error("Network error")),
        );
        if (fetchError) {
          return err("InternalServerError", "Failed to fetch data");
        }

        return ok(rawData);
      };

      const [error, data] = await processData();
      expect(error).toEqual({
        type: "InternalServerError",
        message: "Failed to fetch data",
      });
      expect(data).toBeNull();
    });
  });
});
