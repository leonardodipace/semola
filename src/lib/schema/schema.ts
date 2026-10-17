import {
  formatIssues,
  SchemaError,
  UnsupportedJsonSchemaTargetError,
} from "./errors.js";
import type {
  InferObjectOutput,
  InferOutput,
  Issue,
  JsonSchema,
  LiteralValue,
  ObjectShape,
  Path,
  SafeParseResult,
  SchemaBase,
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "./types.js";

const VENDOR = "semola";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const assertJsonSchemaTarget = (target: StandardJSONSchemaV1.Target) => {
  if (target === "draft-2020-12") return;
  if (target === "draft-07") return;
  if (target === "openapi-3.0") return;

  throw new UnsupportedJsonSchemaTargetError(target);
};

const issue = (message: string, path: Path = []): Issue => {
  if (path.length === 0) {
    return { message };
  }

  return { message, path: [...path] };
};

const fail = (
  message: string,
  path: Path = [],
): StandardSchemaV1.FailureResult => {
  return { issues: [issue(message, path)] };
};

const ok = <T>(value: T): StandardSchemaV1.SuccessResult<T> => {
  return { value };
};

const prependPath = (
  result: StandardSchemaV1.FailureResult,
  key: PropertyKey,
): StandardSchemaV1.FailureResult => {
  return {
    issues: result.issues.map((entry) => {
      return {
        message: entry.message,
        path: [key, ...(entry.path ?? [])],
      };
    }),
  };
};

type ParseFn<Output> = (
  value: unknown,
  path: Path,
) => StandardSchemaV1.Result<Output>;

type JsonSchemaFn = (target: StandardJSONSchemaV1.Target) => JsonSchema;

export abstract class Schema<Output = unknown>
  implements
    SchemaBase<Output>,
    StandardSchemaV1<Output, Output>,
    StandardJSONSchemaV1<Output, Output>
{
  public abstract readonly schemaType: string;

  public readonly "~standard": StandardJSONSchemaV1.Props<Output, Output> &
    StandardSchemaV1.Props<Output, Output>;

  protected constructor(
    private readonly parseValue: ParseFn<Output>,
    private readonly buildJsonSchema: JsonSchemaFn,
  ) {
    this["~standard"] = {
      version: 1,
      vendor: VENDOR,
      validate: (value) => {
        return this.parseValue(value, []);
      },
      jsonSchema: {
        input: (options) => {
          assertJsonSchemaTarget(options.target);
          return this.buildJsonSchema(options.target);
        },
        output: (options) => {
          assertJsonSchemaTarget(options.target);
          return this.buildJsonSchema(options.target);
        },
      },
      types: undefined as unknown as StandardSchemaV1.Types<Output, Output>,
    };
  }

  public parse(data: unknown): Output {
    const result = this.parseValue(data, []);

    if (result.issues) {
      throw new SchemaError(result.issues);
    }

    return result.value;
  }

  public safeParse(data: unknown): SafeParseResult<Output> {
    const result = this.parseValue(data, []);

    if (result.issues) {
      return {
        success: false,
        error: {
          issues: result.issues,
          message: formatIssues(result.issues),
        },
      };
    }

    return { success: true, data: result.value };
  }

  public toJsonSchema(target: StandardJSONSchemaV1.Target = "draft-2020-12") {
    assertJsonSchemaTarget(target);
    return this.buildJsonSchema(target);
  }

  public optional(): OptionalSchema<Output> {
    return new OptionalSchema(this);
  }

  public nullable(): NullableSchema<Output> {
    return new NullableSchema(this);
  }

  public nullish(): NullishSchema<Output> {
    return new NullishSchema(this);
  }

  public refine(
    check: (value: Output) => boolean,
    message = "Invalid input",
  ): Schema<Output> {
    const parseValue = this.parseValue;
    const buildJsonSchema = this.buildJsonSchema;
    const schemaType = this.schemaType;

    return new (class extends Schema<Output> {
      public readonly schemaType = schemaType;
    })((value, path) => {
      const result = parseValue(value, path);

      if (result.issues) {
        return result;
      }

      if (!check(result.value)) {
        return fail(message, path);
      }

      return ok(result.value);
    }, buildJsonSchema);
  }
}

class LeafSchema<Output> extends Schema<Output> {
  public readonly schemaType: string;

  public constructor(
    schemaType: string,
    parseValue: ParseFn<Output>,
    buildJsonSchema: JsonSchemaFn,
  ) {
    super(parseValue, buildJsonSchema);
    this.schemaType = schemaType;
  }
}

export class StringSchema extends Schema<string> {
  public readonly schemaType = "string";

  private readonly checks: ReadonlyArray<
    (value: string, path: Path) => Issue | undefined
  >;
  private readonly jsonExtras: JsonSchema;

  private constructor(
    checks: ReadonlyArray<
      (value: string, path: Path) => Issue | undefined
    > = [],
    jsonExtras: JsonSchema = {},
  ) {
    super(
      (value, path) => {
        if (typeof value !== "string") {
          return fail("Expected string", path);
        }

        for (const check of checks) {
          const nextIssue = check(value, path);

          if (nextIssue) {
            return { issues: [nextIssue] };
          }
        }

        return ok(value);
      },
      () => {
        return { type: "string", ...jsonExtras };
      },
    );

    this.checks = checks;
    this.jsonExtras = jsonExtras;
  }

  public static create() {
    return new StringSchema();
  }

  private withCheck(
    check: (value: string, path: Path) => Issue | undefined,
    extras: JsonSchema,
  ) {
    return new StringSchema([...this.checks, check], {
      ...this.jsonExtras,
      ...extras,
    });
  }

  public min(length: number, message?: string) {
    return this.withCheck(
      (value, path) => {
        if (value.length >= length) return;

        return issue(message ?? `Expected string length >= ${length}`, path);
      },
      { minLength: length },
    );
  }

  public max(length: number, message?: string) {
    return this.withCheck(
      (value, path) => {
        if (value.length <= length) return;

        return issue(message ?? `Expected string length <= ${length}`, path);
      },
      { maxLength: length },
    );
  }

  public length(length: number, message?: string) {
    return this.withCheck(
      (value, path) => {
        if (value.length === length) return;

        return issue(message ?? `Expected string length == ${length}`, path);
      },
      { minLength: length, maxLength: length },
    );
  }

  public regex(pattern: RegExp, message = "Invalid string") {
    return this.withCheck(
      (value, path) => {
        if (pattern.test(value)) return;

        return issue(message, path);
      },
      { pattern: pattern.source },
    );
  }

  public email(message = "Invalid email") {
    return this.withCheck(
      (value, path) => {
        if (EMAIL_PATTERN.test(value)) return;

        return issue(message, path);
      },
      { format: "email" },
    );
  }

  public url(message = "Invalid url") {
    return this.withCheck(
      (value, path) => {
        try {
          new URL(value);
          return;
        } catch {
          return issue(message, path);
        }
      },
      { format: "uri" },
    );
  }

  public startsWith(prefix: string, message?: string) {
    return this.withCheck((value, path) => {
      if (value.startsWith(prefix)) return;

      return issue(message ?? `Expected string to start with ${prefix}`, path);
    }, {});
  }

  public endsWith(suffix: string, message?: string) {
    return this.withCheck((value, path) => {
      if (value.endsWith(suffix)) return;

      return issue(message ?? `Expected string to end with ${suffix}`, path);
    }, {});
  }

  public includes(search: string, message?: string) {
    return this.withCheck((value, path) => {
      if (value.includes(search)) return;

      return issue(message ?? `Expected string to include ${search}`, path);
    }, {});
  }
}

export class NumberSchema extends Schema<number> {
  public readonly schemaType = "number";

  private readonly checks: ReadonlyArray<
    (value: number, path: Path) => Issue | undefined
  >;
  private readonly jsonExtras: JsonSchema;
  private readonly integerOnly: boolean;

  private constructor(
    checks: ReadonlyArray<
      (value: number, path: Path) => Issue | undefined
    > = [],
    jsonExtras: JsonSchema = {},
    integerOnly = false,
  ) {
    super(
      (value, path) => {
        if (typeof value !== "number") {
          return fail("Expected number", path);
        }

        if (!Number.isFinite(value)) {
          return fail("Expected finite number", path);
        }

        if (integerOnly) {
          if (!Number.isInteger(value)) {
            return fail("Expected integer", path);
          }
        }

        for (const check of checks) {
          const nextIssue = check(value, path);

          if (nextIssue) {
            return { issues: [nextIssue] };
          }
        }

        return ok(value);
      },
      () => {
        if (integerOnly) {
          return { type: "integer", ...jsonExtras };
        }

        return { type: "number", ...jsonExtras };
      },
    );

    this.checks = checks;
    this.jsonExtras = jsonExtras;
    this.integerOnly = integerOnly;
  }

  public static create() {
    return new NumberSchema();
  }

  private withCheck(
    check: (value: number, path: Path) => Issue | undefined,
    extras: JsonSchema,
    integerOnly = this.integerOnly,
  ) {
    return new NumberSchema(
      [...this.checks, check],
      { ...this.jsonExtras, ...extras },
      integerOnly,
    );
  }

  public min(value: number, message?: string) {
    return this.withCheck(
      (candidate, path) => {
        if (candidate >= value) return;

        return issue(message ?? `Expected number >= ${value}`, path);
      },
      { minimum: value },
    );
  }

  public max(value: number, message?: string) {
    return this.withCheck(
      (candidate, path) => {
        if (candidate <= value) return;

        return issue(message ?? `Expected number <= ${value}`, path);
      },
      { maximum: value },
    );
  }

  public int(message = "Expected integer") {
    return this.withCheck(
      (candidate, path) => {
        if (Number.isInteger(candidate)) return;

        return issue(message, path);
      },
      {},
      true,
    );
  }

  public positive(message = "Expected positive number") {
    return this.withCheck(
      (candidate, path) => {
        if (candidate > 0) return;

        return issue(message, path);
      },
      { exclusiveMinimum: 0 },
    );
  }

  public nonnegative(message = "Expected non-negative number") {
    return this.withCheck(
      (candidate, path) => {
        if (candidate >= 0) return;

        return issue(message, path);
      },
      { minimum: 0 },
    );
  }
}

export class BooleanSchema extends Schema<boolean> {
  public readonly schemaType = "boolean";

  public constructor() {
    super(
      (value, path) => {
        if (typeof value !== "boolean") {
          return fail("Expected boolean", path);
        }

        return ok(value);
      },
      () => {
        return { type: "boolean" };
      },
    );
  }
}

export class BigintSchema extends Schema<bigint> {
  public readonly schemaType = "bigint";

  public constructor() {
    super(
      (value, path) => {
        if (typeof value !== "bigint") {
          return fail("Expected bigint", path);
        }

        return ok(value);
      },
      () => {
        // ponytail: JSON Schema has no bigint; document as integer
        return { type: "integer" };
      },
    );
  }
}

export class DateSchema extends Schema<Date> {
  public readonly schemaType = "date";

  public constructor() {
    super(
      (value, path) => {
        if (!(value instanceof Date)) {
          return fail("Expected Date", path);
        }

        if (Number.isNaN(value.getTime())) {
          return fail("Expected valid Date", path);
        }

        return ok(value);
      },
      () => {
        return { type: "string", format: "date-time" };
      },
    );
  }
}

export class LiteralSchema<T extends LiteralValue> extends Schema<T> {
  public readonly schemaType = "literal";

  public constructor(expected: T) {
    super(
      (value, path) => {
        if (value !== expected) {
          return fail(`Expected ${String(expected)}`, path);
        }

        return ok(expected);
      },
      () => {
        return { const: expected };
      },
    );
  }
}

export class EnumSchema<T extends string> extends Schema<T> {
  public readonly schemaType = "enum";

  public constructor(values: readonly T[]) {
    super(
      (value, path) => {
        if (typeof value !== "string") {
          return fail("Expected string", path);
        }

        if (!values.includes(value as T)) {
          return fail(`Expected one of: ${values.join(", ")}`, path);
        }

        return ok(value as T);
      },
      () => {
        return { type: "string", enum: [...values] };
      },
    );
  }
}

export class OptionalSchema<Output> extends Schema<Output | undefined> {
  public readonly schemaType = "optional";

  public constructor(public readonly inner: Schema<Output>) {
    super(
      (value, _path) => {
        if (value === undefined) {
          return ok(undefined);
        }

        return inner["~standard"].validate(value) as StandardSchemaV1.Result<
          Output | undefined
        >;
      },
      (target) => {
        return inner.toJsonSchema(target);
      },
    );
  }
}

export class NullableSchema<Output> extends Schema<Output | null> {
  public readonly schemaType = "nullable";

  public constructor(public readonly inner: Schema<Output>) {
    super(
      (value, _path) => {
        if (value === null) {
          return ok(null);
        }

        return inner["~standard"].validate(
          value,
        ) as StandardSchemaV1.Result<Output | null>;
      },
      (target) => {
        const base = inner.toJsonSchema(target);

        return { anyOf: [base, { type: "null" }] };
      },
    );
  }
}

export class NullishSchema<Output> extends Schema<Output | null | undefined> {
  public readonly schemaType = "nullish";

  public constructor(public readonly inner: Schema<Output>) {
    super(
      (value, _path) => {
        if (value === null) {
          return ok(null);
        }

        if (value === undefined) {
          return ok(undefined);
        }

        return inner["~standard"].validate(value) as StandardSchemaV1.Result<
          Output | null | undefined
        >;
      },
      (target) => {
        const base = inner.toJsonSchema(target);

        return { anyOf: [base, { type: "null" }] };
      },
    );
  }
}

export class ArraySchema<Output> extends Schema<Output[]> {
  public readonly schemaType = "array";

  private readonly checks: ReadonlyArray<
    (value: Output[], path: Path) => Issue | undefined
  >;
  private readonly jsonExtras: JsonSchema;
  private readonly element: Schema<Output>;

  private constructor(
    element: Schema<Output>,
    checks: ReadonlyArray<
      (value: Output[], path: Path) => Issue | undefined
    > = [],
    jsonExtras: JsonSchema = {},
  ) {
    super(
      (value, path) => {
        if (!Array.isArray(value)) {
          return fail("Expected array", path);
        }

        const output: Output[] = [];
        const issues: Issue[] = [];

        for (let index = 0; index < value.length; index++) {
          const itemResult = element["~standard"].validate(value[index]);

          if (itemResult instanceof Promise) {
            return fail("Async schema validation is not supported", [
              ...path,
              index,
            ]);
          }

          if (itemResult.issues) {
            issues.push(...prependPath(itemResult, index).issues);
            continue;
          }

          output.push(itemResult.value);
        }

        if (issues.length > 0) {
          return { issues };
        }

        for (const check of checks) {
          const nextIssue = check(output, path);

          if (nextIssue) {
            return { issues: [nextIssue] };
          }
        }

        return ok(output);
      },
      (target) => {
        return {
          type: "array",
          items: element.toJsonSchema(target),
          ...jsonExtras,
        };
      },
    );

    this.element = element;
    this.checks = checks;
    this.jsonExtras = jsonExtras;
  }

  public static create<Output>(element: Schema<Output>) {
    return new ArraySchema(element);
  }

  private withCheck(
    check: (value: Output[], path: Path) => Issue | undefined,
    extras: JsonSchema,
  ) {
    return new ArraySchema(this.element, [...this.checks, check], {
      ...this.jsonExtras,
      ...extras,
    });
  }

  public min(length: number, message?: string) {
    return this.withCheck(
      (value, path) => {
        if (value.length >= length) return;

        return issue(message ?? `Expected array length >= ${length}`, path);
      },
      { minItems: length },
    );
  }

  public max(length: number, message?: string) {
    return this.withCheck(
      (value, path) => {
        if (value.length <= length) return;

        return issue(message ?? `Expected array length <= ${length}`, path);
      },
      { maxItems: length },
    );
  }

  public nonempty(message = "Expected non-empty array") {
    return this.min(1, message);
  }
}

export class ObjectSchema<Shape extends ObjectShape> extends Schema<
  InferObjectOutput<Shape>
> {
  public readonly schemaType = "object";

  public constructor(shape: Shape) {
    super(
      (value, path) => {
        if (typeof value !== "object") {
          return fail("Expected object", path);
        }

        if (value === null) {
          return fail("Expected object", path);
        }

        if (Array.isArray(value)) {
          return fail("Expected object", path);
        }

        const output: Record<string, unknown> = {};
        const issues: Issue[] = [];
        const record = value as Record<string, unknown>;

        for (const key of Object.keys(shape)) {
          const propertySchema = shape[key];

          if (!propertySchema) {
            continue;
          }

          const hasKey = Object.hasOwn(record, key);
          const propertyValue = record[key];

          if (!hasKey) {
            if (propertySchema.schemaType === "optional") {
              continue;
            }

            if (propertySchema.schemaType === "nullish") {
              continue;
            }

            issues.push(issue("Required", [...path, key]));
            continue;
          }

          const propertyResult =
            propertySchema["~standard"].validate(propertyValue);

          if (propertyResult instanceof Promise) {
            issues.push(
              issue("Async schema validation is not supported", [...path, key]),
            );
            continue;
          }

          if (propertyResult.issues) {
            issues.push(...prependPath(propertyResult, key).issues);
            continue;
          }

          output[key] = propertyResult.value;
        }

        if (issues.length > 0) {
          return { issues };
        }

        return ok(output as InferObjectOutput<Shape>);
      },
      (target) => {
        const properties: Record<string, JsonSchema> = {};
        const required: string[] = [];

        for (const key of Object.keys(shape)) {
          const propertySchema = shape[key];

          if (!propertySchema) {
            continue;
          }

          properties[key] = propertySchema.toJsonSchema(target);

          if (propertySchema.schemaType === "optional") {
            continue;
          }

          if (propertySchema.schemaType === "nullish") {
            continue;
          }

          required.push(key);
        }

        const schema: JsonSchema = {
          type: "object",
          properties,
          additionalProperties: false,
        };

        if (required.length > 0) {
          schema.required = required;
        }

        return schema;
      },
    );
  }
}

export class RecordSchema<Output> extends Schema<Record<string, Output>> {
  public readonly schemaType = "record";

  public constructor(valueSchema: Schema<Output>) {
    super(
      (value, path) => {
        if (typeof value !== "object") {
          return fail("Expected object", path);
        }

        if (value === null) {
          return fail("Expected object", path);
        }

        if (Array.isArray(value)) {
          return fail("Expected object", path);
        }

        const output: Record<string, Output> = {};
        const issues: Issue[] = [];
        const record = value as Record<string, unknown>;

        for (const key of Object.keys(record)) {
          const entryResult = valueSchema["~standard"].validate(record[key]);

          if (entryResult instanceof Promise) {
            issues.push(
              issue("Async schema validation is not supported", [...path, key]),
            );
            continue;
          }

          if (entryResult.issues) {
            issues.push(...prependPath(entryResult, key).issues);
            continue;
          }

          output[key] = entryResult.value;
        }

        if (issues.length > 0) {
          return { issues };
        }

        return ok(output);
      },
      (target) => {
        return {
          type: "object",
          additionalProperties: valueSchema.toJsonSchema(target),
        };
      },
    );
  }
}

export class TupleSchema<T extends readonly SchemaBase[]> extends Schema<{
  [K in keyof T]: InferOutput<T[K]>;
}> {
  public readonly schemaType = "tuple";

  public constructor(items: T) {
    super(
      (value, path) => {
        if (!Array.isArray(value)) {
          return fail("Expected array", path);
        }

        if (value.length !== items.length) {
          return fail(`Expected tuple of length ${items.length}`, path);
        }

        const output: unknown[] = [];
        const issues: Issue[] = [];

        for (let index = 0; index < items.length; index++) {
          const itemSchema = items[index];

          if (!itemSchema) {
            continue;
          }

          const itemResult = itemSchema["~standard"].validate(value[index]);

          if (itemResult instanceof Promise) {
            issues.push(
              issue("Async schema validation is not supported", [
                ...path,
                index,
              ]),
            );
            continue;
          }

          if (itemResult.issues) {
            issues.push(...prependPath(itemResult, index).issues);
            continue;
          }

          output.push(itemResult.value);
        }

        if (issues.length > 0) {
          return { issues };
        }

        return ok(output as { [K in keyof T]: InferOutput<T[K]> });
      },
      (target) => {
        return {
          type: "array",
          minItems: items.length,
          maxItems: items.length,
          prefixItems: items.map((item) => item.toJsonSchema(target)),
          items: false,
        };
      },
    );
  }
}

export class UnionSchema<T extends readonly SchemaBase[]> extends Schema<
  InferOutput<T[number]>
> {
  public readonly schemaType = "union";

  public constructor(options: T) {
    super(
      (value, path) => {
        for (const option of options) {
          const result = option["~standard"].validate(value);

          if (result instanceof Promise) {
            return fail("Async schema validation is not supported", path);
          }

          if (!result.issues) {
            return ok(result.value as InferOutput<T[number]>);
          }
        }

        return { issues: [issue("Invalid input", path)] };
      },
      (target) => {
        return {
          anyOf: options.map((option) => option.toJsonSchema(target)),
        };
      },
    );
  }
}

export const string = () => StringSchema.create();

export const number = () => NumberSchema.create();

export const boolean = () => new BooleanSchema();

export const bigint = () => new BigintSchema();

export const date = () => new DateSchema();

export const literal = <const T extends LiteralValue>(value: T) => {
  return new LiteralSchema(value);
};

export const enumValues = <const T extends readonly [string, ...string[]]>(
  values: T,
) => {
  return new EnumSchema(values);
};

export const array = <Output>(element: Schema<Output>) => {
  return ArraySchema.create(element);
};

export const object = <Shape extends ObjectShape>(shape: Shape) => {
  return new ObjectSchema(shape);
};

export const record = <Output>(valueSchema: Schema<Output>) => {
  return new RecordSchema(valueSchema);
};

export const tuple = <const T extends readonly SchemaBase[]>(items: T) => {
  return new TupleSchema(items);
};

export const union = <
  const T extends readonly [SchemaBase, SchemaBase, ...SchemaBase[]],
>(
  options: T,
) => {
  return new UnionSchema(options);
};

export const optional = <Output>(schema: Schema<Output>) => {
  return schema.optional();
};

export const nullable = <Output>(schema: Schema<Output>) => {
  return schema.nullable();
};

export const nullish = <Output>(schema: Schema<Output>) => {
  return schema.nullish();
};

export const any = () => {
  return new LeafSchema<unknown>(
    "any",
    (value) => ok(value),
    () => {
      return {};
    },
  );
};

export const unknown = () => {
  return new LeafSchema<unknown>(
    "unknown",
    (value) => ok(value),
    () => {
      return {};
    },
  );
};

export const never = () => {
  return new LeafSchema<never>(
    "never",
    (_value, path) => fail("Expected never", path),
    () => {
      return { not: {} };
    },
  );
};

export const nullType = () => {
  return new LeafSchema<null>(
    "null",
    (value, path) => {
      if (value !== null) {
        return fail("Expected null", path);
      }

      return ok(null);
    },
    () => {
      return { type: "null" };
    },
  );
};

export const undefinedType = () => {
  return new LeafSchema<undefined>(
    "undefined",
    (value, path) => {
      if (value !== undefined) {
        return fail("Expected undefined", path);
      }

      return ok(undefined);
    },
    () => {
      return {};
    },
  );
};

export const parse = <Output>(schema: Schema<Output>, data: unknown) => {
  return schema.parse(data);
};

export const safeParse = <Output>(schema: Schema<Output>, data: unknown) => {
  return schema.safeParse(data);
};
