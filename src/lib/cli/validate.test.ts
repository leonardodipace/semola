import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { CliValidationError } from "./errors.js";
import {
  validateArguments,
  validateOptions,
  validateValue,
} from "./validate.js";

describe("validateValue", () => {
  test("returns validated value on success", async () => {
    const value = await validateValue(z.string().min(1), "hello", "str");

    expect(value).toBe("hello");
  });

  test("throws CliValidationError with formatted message on failure", async () => {
    const promise = validateValue(z.string().min(3), "hi", "str");

    await expect(promise).rejects.toMatchObject({
      name: "CliValidationError",
      message: expect.stringContaining("str:"),
    });
  });
});

describe("validateArguments", () => {
  test("throws MissingArgumentError when too few positional values", async () => {
    const defs = [{ name: "pkg", schema: z.string() }];
    const promise = validateArguments(defs, []);

    await expect(promise).rejects.toMatchObject({
      name: "MissingArgumentError",
      message: "Missing argument: pkg",
    });
  });
});

describe("validateOptions", () => {
  test("applies string defaults when value is missing", async () => {
    const options = await validateOptions(
      [{ name: "separator", schema: z.string().default(",") }],
      {},
    );

    expect(options).toEqual({ separator: "," });
  });

  test("applies boolean defaults when value is missing", async () => {
    const options = await validateOptions(
      [{ name: "first", schema: z.boolean().default(false) }],
      {},
    );

    expect(options).toEqual({ first: false });
  });

  test("uses provided option values", async () => {
    const options = await validateOptions(
      [
        { name: "separator", schema: z.string().default(",") },
        { name: "first", schema: z.boolean().default(false) },
      ],
      { separator: "|", first: true },
    );

    expect(options).toEqual({ separator: "|", first: true });
  });
});

describe("CliValidationError", () => {
  test("is thrown from validateValue", async () => {
    const promise = validateValue(z.number(), "not-a-number", "count");

    await expect(promise).rejects.toBeInstanceOf(CliValidationError);
  });
});
