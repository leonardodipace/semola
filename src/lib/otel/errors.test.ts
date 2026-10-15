import { describe, expect, test } from "bun:test";
import { ExportError, InvalidOptionsError } from "./errors.js";

describe("ExportError", () => {
  test("sets name and message", () => {
    const error = new ExportError("boom");
    expect(error.retryable).toBe(true);
    expect(error.name).toBe("ExportError");
    expect(error.message).toBe("boom");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("InvalidOptionsError", () => {
  test("sets name and message", () => {
    const error = new InvalidOptionsError("bad");
    expect(error.name).toBe("InvalidOptionsError");
    expect(error.message).toBe("bad");
    expect(error).toBeInstanceOf(Error);
  });
});
