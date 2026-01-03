import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { validateSchema } from "./validator.js";

describe("validateSchema", () => {
  test("should validate data with valid schema", async () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const [error, result] = await validateSchema(schema, {
      name: "John",
      age: 30,
    });

    expect(error).toBeNull();
    expect(result).toEqual({ name: "John", age: 30 });
  });

  test("should return error for invalid data", async () => {
    const schema = z.object({
      name: z.string(),
      email: z.string().email(),
    });

    const [error, result] = await validateSchema(schema, {
      name: "John",
      email: "invalid-email",
    });

    expect(error).not.toBeNull();
    expect(error?.type).toBe("ValidationError");
    expect(error?.message).toContain("email");
    expect(result).toBeNull();
  });

  test("should handle undefined schema by returning data as-is", async () => {
    const [error, result] = await validateSchema(undefined, { foo: "bar" });

    expect(error).toBeNull();
    expect(result).toEqual({ foo: "bar" });
  });

  test("should format multiple validation errors", async () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      email: z.string().email(),
    });

    const [error, result] = await validateSchema(schema, {
      name: 123,
      age: "not-a-number",
      email: "invalid",
    });

    expect(error).not.toBeNull();
    expect(error?.type).toBe("ValidationError");
    expect(error?.message).toContain("name");
    expect(error?.message).toContain("age");
    expect(error?.message).toContain("email");
    expect(result).toBeNull();
  });

  test("should handle nested object validation", async () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        address: z.object({
          street: z.string(),
        }),
      }),
    });

    const [error, result] = await validateSchema(schema, {
      user: {
        name: "John",
        address: {
          street: 123,
        },
      },
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("user.address.street");
    expect(result).toBeNull();
  });

  test("should handle array validation", async () => {
    const schema = z.object({
      tags: z.array(z.string()),
    });

    const [error, result] = await validateSchema(schema, {
      tags: ["js", "ts", "node"],
    });

    expect(error).toBeNull();
    expect(result).toEqual({ tags: ["js", "ts", "node"] });
  });

  test("should handle array validation errors with index", async () => {
    const schema = z.object({
      items: z.array(z.number()),
    });

    const [error, result] = await validateSchema(schema, {
      items: [1, 2, "not-a-number", 4],
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("items");
    expect(result).toBeNull();
  });

  test("should handle schema transformations", async () => {
    const schema = z.object({
      age: z.string().transform((val) => Number.parseInt(val, 10)),
    });

    const [error, result] = await validateSchema(schema, { age: "25" });

    expect(error).toBeNull();
    expect(result).toEqual({ age: 25 });
  });

  test("should handle optional fields", async () => {
    const schema = z.object({
      name: z.string(),
      nickname: z.string().optional(),
    });

    const [error, result] = await validateSchema(schema, { name: "John" });

    expect(error).toBeNull();
    expect(result).toEqual({ name: "John" });
  });

  test("should handle default values", async () => {
    const schema = z.object({
      name: z.string(),
      role: z.string().default("user"),
    });

    const [error, result] = await validateSchema(schema, { name: "John" });

    expect(error).toBeNull();
    expect(result).toEqual({ name: "John", role: "user" });
  });

  test("should handle custom error messages", async () => {
    const schema = z.object({
      password: z.string().min(8, "Password must be at least 8 characters"),
    });

    const [error, result] = await validateSchema(schema, { password: "short" });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("Password must be at least 8 characters");
    expect(result).toBeNull();
  });

  test("should handle refinements", async () => {
    const schema = z
      .object({
        password: z.string(),
        confirmPassword: z.string(),
      })
      .refine((data) => data.password === data.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
      });

    const [error, result] = await validateSchema(schema, {
      password: "password123",
      confirmPassword: "different",
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("Passwords do not match");
    expect(result).toBeNull();
  });
});
