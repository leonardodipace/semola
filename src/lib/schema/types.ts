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

export interface SchemaBase<out Output = unknown> {
  readonly schemaType: string;
  readonly run: (
    value: unknown,
    path: PropertyKey[],
    issues: Issue[],
  ) => Output;
  readonly "~standard": StandardSchemaV1.Props<Output, Output> &
    StandardJSONSchemaV1.Props<Output, Output>;
  parse(data: unknown): Output;
  safeParse(data: unknown): SafeParseResult<Output>;
  toJsonSchema(target?: StandardJSONSchemaV1.Target): JsonSchema;
  toInline(
    expr: string,
    pathPrefix: PropertyKey[],
    binds: unknown[],
    dynamicIndex?: string,
  ): string | null;
}

export type ObjectShape = Record<string, SchemaBase>;

export type SchemaLike = SchemaBase;

export type InferOutput<T> = T extends SchemaBase<infer O> ? O : never;

export type InferInput<T> = InferOutput<T>;

export type InferObjectOutput<Shape extends ObjectShape> = {
  [K in keyof Shape as Shape[K] extends { readonly schemaType: "optional" }
    ? never
    : K]: InferOutput<Shape[K]>;
} & {
  [K in keyof Shape as Shape[K] extends { readonly schemaType: "optional" }
    ? K
    : never]?: InferOutput<Shape[K]>;
};

export type InferObjectInput<Shape extends ObjectShape> =
  InferObjectOutput<Shape>;

export type LiteralValue = string | number | boolean | bigint | null;
