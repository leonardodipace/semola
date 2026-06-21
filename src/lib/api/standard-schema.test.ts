import { describe, expect, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as v from "valibot";
import { z } from "zod";
import {
  invalidUser,
  providers,
  schemaFor,
  validUser,
} from "./standard-schema.fixtures.js";
import { formatIssuePath, formatValidationIssues } from "./standard-schema.js";
import {
  validateBody,
  validateCookies,
  validateHeaders,
  validateParams,
  validateQuery,
  validateSchema,
} from "./validation/index.js";

describe("Standard Schema support", () => {
  for (const provider of providers) {
    describe(provider, () => {
      test("validateSchema returns parsed value on success", async () => {
        const schema = schemaFor.userWithAge(provider);
        const data = await validateSchema(schema, validUser);

        expect(data).toEqual(validUser);
      });

      test("validateSchema formats nested paths on failure", async () => {
        const schema = schemaFor.userWithAge(provider);

        await expect(validateSchema(schema, invalidUser)).rejects.toMatchObject(
          {
            message: expect.stringContaining("user.email:"),
          },
        );
        await expect(validateSchema(schema, invalidUser)).rejects.toMatchObject(
          {
            message: expect.stringContaining("age:"),
          },
        );
      });

      test("validateBody validates JSON body and returns parsed data", async () => {
        const schema = schemaFor.idNumber(provider);
        const req = new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: 123 }),
        });

        const data = await validateBody(req, schema);

        expect(data).toEqual({ id: 123 });
      });

      test("validateBody caches parsed body and reuses on subsequent calls", async () => {
        const schema = schemaFor.nameString(provider);
        const req = new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "test" }),
        });
        const bodyCache = { parsed: false, value: undefined as unknown };

        const data1 = await validateBody(req, schema, bodyCache);

        expect(data1).toEqual({ name: "test" });
        expect(bodyCache.parsed).toBe(true);
        expect(bodyCache.value).toEqual({ name: "test" });

        const data2 = await validateBody(req, schema, bodyCache);

        expect(data2).toEqual({ name: "test" });
      });

      test("validateBody validates cached body against different schemas", async () => {
        const partialSchema = schemaFor.nameString(provider);
        const fullSchema = schemaFor.nameAndAge(provider);
        const req = new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "test", age: 25 }),
        });
        const bodyCache = { parsed: false, value: undefined as unknown };

        const data1 = await validateBody(req, partialSchema, bodyCache);

        expect(data1).toMatchObject({ name: "test" });

        const data2 = await validateBody(req, fullSchema, bodyCache);

        expect(data2).toEqual({ name: "test", age: 25 });
      });

      test("validateQuery handles single and repeated query parameters", async () => {
        const schema = schemaFor.queryFilterTags(provider);
        const req = new Request("http://localhost?filter=active&tags=a&tags=b");

        const data = await validateQuery(req, schema);

        expect(data).toEqual({ filter: "active", tags: ["a", "b"] });
      });

      test("validateHeaders validates normalized lowercase headers", async () => {
        const schema = schemaFor.apiKeyHeader(provider);
        const req = new Request("http://localhost", {
          headers: { "X-API-KEY": "secret-123" },
        });

        const data = await validateHeaders(req, schema);

        expect(data).toEqual({ "x-api-key": "secret-123" });
      });

      test("validateCookies parses and validates cookies", async () => {
        const schema = schemaFor.themeCookies(provider);
        const req = new Request("http://localhost", {
          headers: { cookie: "theme=dark; session=abc" },
        });

        const data = await validateCookies(req, schema);

        expect(data).toEqual({ theme: "dark", session: "abc" });
      });

      test("validateCookies throws when required cookie is missing", async () => {
        const schema = schemaFor.requiredCookie(provider);
        const req = new Request("http://localhost");

        await expect(validateCookies(req, schema)).rejects.toMatchObject({
          message: expect.stringContaining("requiredCookie:"),
        });
      });

      test("validateParams validates path parameters", async () => {
        const schema = schemaFor.idNumber(provider);
        const req = { params: { id: "123" } } as unknown as Bun.BunRequest;

        await expect(validateParams(req, schema)).rejects.toMatchObject({
          message: expect.stringContaining("id:"),
        });
      });
    });
  }

  test("formatIssuePath handles Valibot path segments", async () => {
    const schema = v.object({
      user: v.object({ email: v.pipe(v.string(), v.email()) }),
    });
    const result = await schema["~standard"].validate(invalidUser);

    if (!result.issues) {
      throw new Error("expected validation failure");
    }

    const [emailIssue] = result.issues;

    if (!emailIssue) {
      throw new Error("expected email validation issue");
    }

    expect(formatIssuePath(emailIssue)).toBe("user.email");
    expect(formatValidationIssues(result.issues)).toContain("user.email:");
  });
});

describe("Validation Module (schema-agnostic)", () => {
  const anySchema = z.any() as StandardSchemaV1;

  test("validateBody throws ParseError for malformed JSON", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json }",
    });

    await expect(validateBody(req, anySchema)).rejects.toMatchObject({
      name: "ParseError",
    });
  });

  test("validateBody skips validation when Content-Type is not JSON", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    });

    const data = await validateBody(req, anySchema);

    expect(data).toBeUndefined();
  });
});
