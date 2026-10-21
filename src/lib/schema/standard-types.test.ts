import { describe, expect, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { InferOutput as ApiInferOutput } from "../api/types.js";
import { number, object, string } from "./schema.js";

describe("Standard Schema type inference", () => {
  test("~standard.types is omitted at runtime", () => {
    const schema = string();

    expect(schema["~standard"].version).toBe(1);
    expect(schema["~standard"].vendor).toBe("semola");
    expect(Object.hasOwn(schema["~standard"], "types")).toBe(false);
  });

  test("StandardSchemaV1.InferOutput reads schema output", () => {
    const schema = object({
      name: string(),
      age: number(),
    });

    type SpecOut = StandardSchemaV1.InferOutput<typeof schema>;
    type SpecIn = StandardSchemaV1.InferInput<typeof schema>;
    type ApiOut = ApiInferOutput<typeof schema>;
    type Types = (typeof schema)["~standard"]["types"];

    const specOut: SpecOut = { name: "Ada", age: 36 };
    const specIn: SpecIn = { name: "Ada", age: 36 };
    const apiOut: ApiOut = { name: "Ada", age: 36 };
    const types: Types = { input: specIn, output: specOut };

    expect(specOut.name).toBe("Ada");
    expect(specIn.age).toBe(36);
    expect(apiOut).toEqual(types.output);

    // @ts-expect-error age is required on inferred output
    const _missingAge: SpecOut = { name: "Ada" };
    // @ts-expect-error name must be string
    const _badName: SpecOut = { name: 1, age: 36 };
    // @ts-expect-error api InferOutput matches schema output
    const _apiBad: ApiOut = { name: "Ada" };

    void _missingAge;
    void _badName;
    void _apiBad;
  });

  test("leaf schema InferOutput is the leaf type", () => {
    const schema = string();

    type Out = StandardSchemaV1.InferOutput<typeof schema>;
    const value: Out = "ok";

    expect(value).toBe("ok");

    // @ts-expect-error string schema output is string
    const _bad: Out = 1;

    void _bad;
  });
});
