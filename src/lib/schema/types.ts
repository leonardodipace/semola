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
}

/** Object fields are Schema instances; `toInline` feeds object codegen. */
export type ObjectShape = Record<
  string,
  SchemaBase & {
    toInline(
      expr: string,
      pathPrefix: PropertyKey[],
      binds: unknown[],
      dynamicIndex?: string,
    ): string | null;
  }
>;

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
