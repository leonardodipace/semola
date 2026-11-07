import { describe, expect, test } from "bun:test";
import * as v from "valibot";
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
} from "./validate.js";

describe("Standard Schema support", () => {
  for (const provider of providers) {
    describe(provider, () => {
      test("validateSchema returns parsed value on success", async () => {
        const schema = schemaFor.userWithAge(provider);
        const data = await validateSchema(schema, validUser);

        expect(data).toEqual(validUser);
      });

      test("validateSchema formats nested paths on failure", () => {
        const schema = schemaFor.userWithAge(provider);

        expect(() => validateSchema(schema, invalidUser)).toThrow(
          expect.objectContaining({
            message: expect.stringContaining("user.email:"),
          }),
        );
        expect(() => validateSchema(schema, invalidUser)).toThrow(
          expect.objectContaining({
            message: expect.stringContaining("age:"),
          }),
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

      test("validateCookies throws when required cookie is missing", () => {
        const schema = schemaFor.requiredCookie(provider);
        const req = new Request("http://localhost");

        expect(() => validateCookies(req, schema)).toThrow(
          expect.objectContaining({
            message: expect.stringContaining("requiredCookie:"),
          }),
        );
      });

      test("validateParams validates path parameters", () => {
        const schema = schemaFor.idNumber(provider);
        const req = { params: { id: "123" } } as unknown as Bun.BunRequest;

        expect(() => validateParams(req, schema)).toThrow(
          expect.objectContaining({
            message: expect.stringContaining("id:"),
          }),
        );
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
