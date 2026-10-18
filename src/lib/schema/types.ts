import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";

export type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
  StandardTypedV1,
} from "@standard-schema/spec";

export type Path = ReadonlyArray<PropertyKey>;

export type Issue = StandardSchemaV1.Issue;

export type SafeParseSuccess<T> = {
  success: true;
  data: T;
};

export type SafeParseFailure = {
  success: false;
  error: {
    issues: ReadonlyArray<Issue>;
    message: string;
  };
};

export type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseFailure;

export type JsonSchema = Record<string, unknown>;

export type JsonSchemaMode = "input" | "output";

export type JsonSchemaFn = (
  target: StandardJSONSchemaV1.Target,
  mode: JsonSchemaMode,
) => JsonSchema;

export type RunFn<Output> = (
  value: unknown,
  path: PropertyKey[],
  issues: Issue[],
) => Output;

export type StringRule =
  | { kind: "min"; length: number; message: string }
  | { kind: "max"; length: number; message: string }
  | { kind: "length"; length: number; message: string }
  | { kind: "regex"; pattern: RegExp; message: string }
  | { kind: "email"; message: string }
  | { kind: "url"; message: string }
  | { kind: "uuid"; message: string }
  | { kind: "startsWith"; prefix: string; message: string }
  | { kind: "endsWith"; suffix: string; message: string }
  | { kind: "includes"; search: string; message: string };

export type NumberRule =
  | { kind: "min"; value: number; message: string }
  | { kind: "max"; value: number; message: string }
  | { kind: "positive"; message: string }
  | { kind: "nonnegative"; message: string };

export type ArrayBound =
  | { kind: "min"; length: number; message: string }
  | { kind: "max"; length: number; message: string };

export type InlineFn = (
  expr: string,
  pathPrefix: PropertyKey[],
  binds: unknown[],
  dynamicIndex?: string,
) => string | null;

export type ObjectField = {
  key: string;
  run: RunFn<unknown>;
  optional: boolean;
  schema: SchemaBase;
  toInline: InlineFn;
};

export interface SchemaBase<out Output = unknown> {
  readonly schemaType: string;
  readonly run: RunFn<Output>;
  readonly "~standard": StandardSchemaV1.Props<Output, Output> &
    StandardJSONSchemaV1.Props<Output, Output>;
  parse(data: unknown): Output;
  safeParse(data: unknown): SafeParseResult<Output>;
  toJsonSchema(target?: StandardJSONSchemaV1.Target): JsonSchema;
  /** Object codegen helper. Missing means the field cannot be inlined. */
  toInline?: InlineFn;
}

export type ObjectShape = Record<string, SchemaBase>;

export type InferOutput<T> = T extends SchemaBase<infer O> ? O : never;

export type InferInput<T> = InferOutput<T>;

type OptionalObjectKey<T> = T extends {
  readonly schemaType: "optional" | "nullish";
}
  ? true
  : false;

export type InferObjectOutput<Shape extends ObjectShape> = {
  [K in keyof Shape as OptionalObjectKey<Shape[K]> extends true
    ? never
    : K]: InferOutput<Shape[K]>;
} & {
  [K in keyof Shape as OptionalObjectKey<Shape[K]> extends true
    ? K
    : never]?: InferOutput<Shape[K]>;
};

export type LiteralValue = string | number | boolean | bigint | null;
