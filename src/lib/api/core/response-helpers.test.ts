import { describe, expect, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { z } from "zod";
import { SchemaConfigError } from "../errors.js";
import {
  badRequest,
  html,
  json,
  mapValidationError,
  redirect,
  text,
  validatingJson,
} from "./response-helpers.js";

describe("response-helpers", () => {
  test("json uses default status 200", async () => {
    const res = json(200, { ok: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("json sets explicit status", async () => {
    const res = json(201, { id: 1 });
    expect(res.status).toBe(201);
  });

  test("text uses default status 200", async () => {
    const res = text(200, "hello");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  test("text sets explicit status", async () => {
    const res = text(404, "missing");
    expect(res.status).toBe(404);
  });

  test("html sets content type", async () => {
    const res = html(200, "<p>hi</p>");
    expect(res.headers.get("Content-Type")).toBe("text/html");
    expect(await res.text()).toBe("<p>hi</p>");
  });

  test("redirect returns redirect response", () => {
    const res = redirect(302, "https://example.com");
    expect(res.status).toBe(302);
  });

  test("badRequest returns 400 with message", async () => {
    const res = badRequest("invalid");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "invalid" });
  });

  test("validatingJson passes valid output", async () => {
    const validate = validatingJson({ 200: z.object({ name: z.string() }) });
    const res = await validate(200, { name: "Alice" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Alice" });
  });

  test("validatingJson returns 400 for invalid output", async () => {
    const validate = validatingJson({ 200: z.object({ name: z.string() }) });
    const res = await validate(200, { name: 123 });
    expect(res.status).toBe(400);
  });

  test("validatingJson skips validation for unlisted status", async () => {
    const validate = validatingJson({ 200: z.object({ name: z.string() }) });
    const res = await validate(404, { name: 123 });
    expect(res.status).toBe(404);
  });

  test("mapValidationError rethrows schema config errors", () => {
    const error = new SchemaConfigError(
      "Async schema validation is not supported",
    );

    expect(() => mapValidationError(error)).toThrow(SchemaConfigError);
  });

  test("validatingJson rethrows schema config errors", () => {
    const schema = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: () => Promise.resolve({ value: {} }),
      },
    } as StandardSchemaV1;
    const validate = validatingJson({ 200: schema });

    expect(() => validate(200, {})).toThrow(SchemaConfigError);
  });
});
