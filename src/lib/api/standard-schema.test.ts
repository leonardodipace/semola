import { describe, expect, test } from "bun:test";
import { type } from "arktype";
import * as v from "valibot";
import { z } from "zod";
import { formatIssuePath, formatValidationIssues } from "./standard-schema.js";
import {
  validateBody,
  validateQuery,
  validateSchema,
} from "./validation/index.js";

const validUser = {
  user: { email: "user@example.com" },
  age: 30,
};

const invalidUser = {
  user: { email: "bad" },
};

const schemas = {
  zod: z.object({
    user: z.object({ email: z.email() }),
    age: z.number(),
  }),
  valibot: v.object({
    user: v.object({ email: v.pipe(v.string(), v.email()) }),
    age: v.number(),
  }),
  arktype: type({
    user: { email: "string.email" },
    age: "number",
  }),
};

describe("Standard Schema support", () => {
  for (const [name, schema] of Object.entries(schemas)) {
    describe(name, () => {
      test("validateSchema returns parsed value on success", async () => {
        const data = await validateSchema(schema, validUser);

        expect(data).toEqual(validUser);
      });

      test("validateSchema formats nested paths on failure", async () => {
        const promise = validateSchema(schema, invalidUser);

        await expect(promise).rejects.toMatchObject({
          message: expect.stringContaining("user.email:"),
        });
        await expect(validateSchema(schema, invalidUser)).rejects.toMatchObject(
          {
            message: expect.stringContaining("age:"),
          },
        );
      });

      test("validateBody parses and validates JSON", async () => {
        const req = new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: 123 }),
        });
        const bodySchema =
          name === "zod"
            ? z.object({ id: z.number() })
            : name === "valibot"
              ? v.object({ id: v.number() })
              : type({ id: "number" });

        const data = await validateBody(req, bodySchema);

        expect(data).toEqual({ id: 123 });
      });

      test("validateQuery handles repeated query parameters", async () => {
        const req = new Request("http://localhost?filter=active&tags=a&tags=b");
        const querySchema =
          name === "zod"
            ? z.object({ filter: z.string(), tags: z.array(z.string()) })
            : name === "valibot"
              ? v.object({ filter: v.string(), tags: v.array(v.string()) })
              : type({ filter: "string", tags: "string[]" });

        const data = await validateQuery(req, querySchema);

        expect(data).toEqual({ filter: "active", tags: ["a", "b"] });
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
