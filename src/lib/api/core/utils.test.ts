import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Middleware } from "../middleware/index.js";
import {
  bodyHasMultipleReaders,
  getFullPath,
  resolveValidation,
} from "./utils.js";

describe("utils", () => {
  describe("getFullPath", () => {
    test("returns path when no prefix", () => {
      expect(getFullPath({ path: "/hello" })).toBe("/hello");
    });

    test("normalizes trailing slashes on prefix and path", () => {
      expect(getFullPath({ prefix: "/api/", path: "/hello/" })).toBe(
        "/api/hello",
      );
    });

    test("returns prefix when path is root", () => {
      expect(getFullPath({ prefix: "/api/v1", path: "/" })).toBe("/api/v1");
    });

    test("returns path when prefix is root", () => {
      expect(getFullPath({ prefix: "/", path: "/hello" })).toBe("/hello");
    });
  });

  describe("resolveValidation", () => {
    test("defaults to both enabled", () => {
      expect(resolveValidation()).toEqual({ input: true, output: true });
      expect(resolveValidation(true)).toEqual({ input: true, output: true });
    });

    test("disables both when false", () => {
      expect(resolveValidation(false)).toEqual({ input: false, output: false });
    });

    test("respects partial options", () => {
      expect(resolveValidation({ input: false })).toEqual({
        input: false,
        output: true,
      });
      expect(resolveValidation({ output: false })).toEqual({
        input: true,
        output: false,
      });
    });
  });

  describe("bodyHasMultipleReaders", () => {
    test("returns false for single body reader", () => {
      expect(
        bodyHasMultipleReaders({
          middlewares: [],
          request: { body: z.object({ name: z.string() }) },
        }),
      ).toBe(false);
    });

    test("returns true when middleware and route both read body", () => {
      const mw = new Middleware({
        request: { body: z.object({ name: z.string() }) },
        handler: () => ({}),
      });

      expect(
        bodyHasMultipleReaders({
          middlewares: [mw],
          request: { body: z.object({ name: z.string(), age: z.number() }) },
        }),
      ).toBe(true);
    });
  });
});
