import {
  type ArrayBound,
  applyNumberRules,
  applyStringRules,
  compileObjectValidate,
  emitIssue,
  emitNumberRules,
  emitStringRules,
  formatPathExpr,
  type NumberRule,
  type ObjectField,
  pushIssue,
  type RunFn,
  type StringRule,
} from "./compile.js";
import {
  formatIssues,
  SchemaError,
  UnsupportedJsonSchemaConversionError,
  UnsupportedJsonSchemaTargetError,
} from "./errors.js";
import type {
  InferObjectOutput,
  InferOutput,
  Issue,
  JsonSchema,
  JsonSchemaMode,
  LiteralValue,
  ObjectShape,
  SafeParseResult,
  SchemaBase,
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "./types.js";

const VENDOR = "semola";
const DEFAULT_JSON_SCHEMA_TARGET = "draft-2020-12" as const;
const BIGINT_FAILURE = 0n;

const assertJsonSchemaTarget = (target: StandardJSONSchemaV1.Target) => {
  if (target === DEFAULT_JSON_SCHEMA_TARGET) {
    return;
  }

  throw new UnsupportedJsonSchemaTargetError(target);
};

type JsonSchemaFn = (
  target: StandardJSONSchemaV1.Target,
  mode: JsonSchemaMode,
) => JsonSchema;

const childJsonSchema = (
  schema: SchemaBase,
  target: StandardJSONSchemaV1.Target,
  mode: JsonSchemaMode,
) => {
  if (mode === "output") {
    return schema.toJsonSchema(target);
  }

  return schema["~standard"].jsonSchema.input({ target }) as JsonSchema;
};

/** Sync validation reuses these when not re-entrant. */
const TLS_PATH: PropertyKey[] = [];
const TLS_ISSUES: Issue[] = [];
let tlsDepth = 0;

const runTopLevel = <Output>(run: RunFn<Output>, value: unknown) => {
  tlsDepth += 1;

  try {
    if (tlsDepth === 1) {
      TLS_PATH.length = 0;
      TLS_ISSUES.length = 0;
      const output = run(value, TLS_PATH, TLS_ISSUES);

      if (TLS_ISSUES.length > 0) {
        return { issues: TLS_ISSUES.slice() as Issue[], output: undefined };
      }

      return { issues: undefined, output };
    }

    const path: PropertyKey[] = [];
    const issues: Issue[] = [];
    const output = run(value, path, issues);

    if (issues.length > 0) {
      return { issues, output: undefined };
    }

    return { issues: undefined, output };
  } finally {
    tlsDepth -= 1;
  }
};

const tryEnterObjectTls = () => {
  if (tlsDepth !== 0) {
    return false;
  }

  tlsDepth = 1;
  TLS_ISSUES.length = 0;
  return true;
};

const leaveObjectTls = () => {
  tlsDepth = 0;
};

export abstract class Schema<Output = unknown>
  implements
    SchemaBase<Output>,
    StandardSchemaV1<Output, Output>,
    StandardJSONSchemaV1<Output, Output>
{
  public abstract readonly schemaType: string;

  /** Hot-path validator. On failure pushes to `issues` and return value is ignored. */
  public readonly run: RunFn<Output>;

  public readonly "~standard": StandardJSONSchemaV1.Props<Output, Output> &
    StandardSchemaV1.Props<Output, Output>;

  protected constructor(run: RunFn<Output>, buildJsonSchema: JsonSchemaFn) {
    this.run = run;

    this["~standard"] = {
      version: 1,
      vendor: VENDOR,
      validate: (value) => {
        return this.validateStd(value);
      },
      jsonSchema: {
        input: (options) => {
          assertJsonSchemaTarget(options.target);
          return buildJsonSchema(options.target, "input");
        },
        output: (options) => {
          assertJsonSchemaTarget(options.target);
          return buildJsonSchema(options.target, "output");
        },
      },
      types: undefined as unknown as StandardSchemaV1.Types<Output, Output>,
    };
  }

  public validateStd(value: unknown): StandardSchemaV1.Result<Output> {
    const result = runTopLevel(this.run, value);

    if (result.issues) {
      return { issues: result.issues };
    }

    return { value: result.output as Output };
  }

  public parse(data: unknown): Output {
    const result = runTopLevel(this.run, data);

    if (result.issues) {
      throw new SchemaError(result.issues);
    }

    return result.output as Output;
  }

  public safeParse(data: unknown): SafeParseResult<Output> {
    const result = runTopLevel(this.run, data);

    if (result.issues) {
      return {
        success: false,
        error: {
          issues: result.issues,
          message: formatIssues(result.issues),
        },
      };
    }

    return { success: true, data: result.output as Output };
  }

  public toJsonSchema(
    target: StandardJSONSchemaV1.Target = DEFAULT_JSON_SCHEMA_TARGET,
  ) {
    assertJsonSchemaTarget(target);
    return this["~standard"].jsonSchema.output({ target });
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
    const parentRun = this.run;
    const schemaType = this.schemaType;

    return new (class extends Schema<Output> {
      public readonly schemaType = schemaType;
    })(
      (value, path, issues) => {
        const before = issues.length;
        const output = parentRun(value, path, issues);

        if (issues.length > before) {
          return output;
        }

        if (!check(output)) {
          pushIssue(issues, message, path);
        }

        return output;
      },
      (target, mode) => {
        return childJsonSchema(this, target, mode);
      },
    );
  }

  /** Emit inlined JS for object codegen, or null if not supported. */
  public toInline(
    _expr: string,
    _pathPrefix: PropertyKey[],
    _binds: unknown[],
    _dynamicIndex?: string,
  ): string | null {
    return null;
  }
}

class LeafSchema<Output> extends Schema<Output> {
  public readonly schemaType: string;

  public constructor(
    schemaType: string,
    run: RunFn<Output>,
    buildJsonSchema: JsonSchemaFn,
  ) {
    super(run, buildJsonSchema);
    this.schemaType = schemaType;
  }
}

export class StringSchema extends Schema<string> {
  public readonly schemaType = "string";

  private readonly rules: ReadonlyArray<StringRule>;
  private readonly jsonExtras: JsonSchema;

  private constructor(
    rules: ReadonlyArray<StringRule> = [],
    jsonExtras: JsonSchema = {},
  ) {
    super(
      (value, path, issues) => {
        if (typeof value !== "string") {
          pushIssue(issues, "Expected string", path);
          return "";
        }

        applyStringRules(value, path, issues, rules);
        return value;
      },
      () => {
        return { type: "string", ...jsonExtras };
      },
    );

    this.rules = rules;
    this.jsonExtras = jsonExtras;
  }

  public static create() {
    return new StringSchema();
  }

  private withRule(rule: StringRule, extras: JsonSchema) {
    return new StringSchema([...this.rules, rule], {
      ...this.jsonExtras,
      ...extras,
    });
  }

  public override toInline(
    expr: string,
    pathPrefix: PropertyKey[],
    binds: unknown[],
    dynamicIndex?: string,
  ) {
    return emitStringRules(expr, pathPrefix, this.rules, binds, dynamicIndex);
  }

  public min(length: number, message?: string) {
    return this.withRule(
      {
        kind: "min",
        length,
        message: message ?? `Expected string length >= ${length}`,
      },
      { minLength: length },
    );
  }

  public max(length: number, message?: string) {
    return this.withRule(
      {
        kind: "max",
        length,
        message: message ?? `Expected string length <= ${length}`,
      },
      { maxLength: length },
    );
  }

  public length(length: number, message?: string) {
    return this.withRule(
      {
        kind: "length",
        length,
        message: message ?? `Expected string length == ${length}`,
      },
      { minLength: length, maxLength: length },
    );
  }

  public regex(pattern: RegExp, message = "Invalid string") {
    return this.withRule(
      { kind: "regex", pattern, message },
      { pattern: pattern.source },
    );
  }

  public email(message = "Invalid email") {
    return this.withRule({ kind: "email", message }, { format: "email" });
  }

  public url(message = "Invalid url") {
    return this.withRule({ kind: "url", message }, { format: "uri" });
  }

  public uuid(message = "Invalid uuid") {
    return this.withRule({ kind: "uuid", message }, { format: "uuid" });
  }

  public startsWith(prefix: string, message?: string) {
    return this.withRule(
      {
        kind: "startsWith",
        prefix,
        message: message ?? `Expected string to start with ${prefix}`,
      },
      {},
    );
  }

  public endsWith(suffix: string, message?: string) {
    return this.withRule(
      {
        kind: "endsWith",
        suffix,
        message: message ?? `Expected string to end with ${suffix}`,
      },
      {},
    );
  }

  public includes(search: string, message?: string) {
    return this.withRule(
      {
        kind: "includes",
        search,
        message: message ?? `Expected string to include ${search}`,
      },
      {},
    );
  }
}

export class NumberSchema extends Schema<number> {
  public readonly schemaType = "number";

  private readonly rules: ReadonlyArray<NumberRule>;
  private readonly jsonExtras: JsonSchema;
  private readonly integerOnly: boolean;
  private readonly integerMessage: string;

  private constructor(
    rules: ReadonlyArray<NumberRule> = [],
    jsonExtras: JsonSchema = {},
    integerOnly = false,
    integerMessage = "Expected integer",
  ) {
    super(
      (value, path, issues) => {
        if (typeof value !== "number") {
          pushIssue(issues, "Expected number", path);
          return 0;
        }

        applyNumberRules(
          value,
          path,
          issues,
          rules,
          integerOnly,
          integerMessage,
        );
        return value;
      },
      () => {
        if (integerOnly) {
          return { type: "integer", ...jsonExtras };
        }

        return { type: "number", ...jsonExtras };
      },
    );

    this.rules = rules;
    this.jsonExtras = jsonExtras;
    this.integerOnly = integerOnly;
    this.integerMessage = integerMessage;
  }

  public static create() {
    return new NumberSchema();
  }

  private withRule(rule: NumberRule, extras: JsonSchema) {
    return new NumberSchema(
      [...this.rules, rule],
      { ...this.jsonExtras, ...extras },
      this.integerOnly,
      this.integerMessage,
    );
  }

  public override toInline(
    expr: string,
    pathPrefix: PropertyKey[],
    _binds: unknown[],
    dynamicIndex?: string,
  ) {
    return emitNumberRules(
      expr,
      pathPrefix,
      this.rules,
      this.integerOnly,
      this.integerMessage,
      dynamicIndex,
    );
  }

  public min(value: number, message?: string) {
    return this.withRule(
      {
        kind: "min",
        value,
        message: message ?? `Expected number >= ${value}`,
      },
      { minimum: value },
    );
  }

  public max(value: number, message?: string) {
    return this.withRule(
      {
        kind: "max",
        value,
        message: message ?? `Expected number <= ${value}`,
      },
      { maximum: value },
    );
  }

  public int(message = "Expected integer") {
    return new NumberSchema(this.rules, this.jsonExtras, true, message);
  }

  public positive(message = "Expected positive number") {
    return this.withRule(
      { kind: "positive", message },
      { exclusiveMinimum: 0 },
    );
  }

  public nonnegative(message = "Expected non-negative number") {
    return this.withRule({ kind: "nonnegative", message }, { minimum: 0 });
  }
}

export class BooleanSchema extends Schema<boolean> {
  public readonly schemaType = "boolean";

  public constructor() {
    super(
      (value, path, issues) => {
        if (typeof value !== "boolean") {
          pushIssue(issues, "Expected boolean", path);
          return false;
        }

        return value;
      },
      () => {
        return { type: "boolean" };
      },
    );
  }

  public override toInline(
    expr: string,
    pathPrefix: PropertyKey[],
    _binds: unknown[],
    dynamicIndex?: string,
  ) {
    return `if(typeof ${expr}!=='boolean'){${emitIssue('"Expected boolean"', formatPathExpr(pathPrefix, dynamicIndex))}}`;
  }
}

export class BigintSchema extends Schema<bigint> {
  public readonly schemaType = "bigint";

  public constructor() {
    super(
      (value, path, issues) => {
        if (typeof value !== "bigint") {
          pushIssue(issues, "Expected bigint", path);
          return BIGINT_FAILURE;
        }

        return value;
      },
      (_target, mode) => {
        if (mode === "input") {
          throw new UnsupportedJsonSchemaConversionError("bigint");
        }

        // ponytail: JSON Schema has no bigint; document as integer for output
        return { type: "integer" };
      },
    );
  }
}

export class DateSchema extends Schema<Date> {
  public readonly schemaType = "date";

  public constructor() {
    super(
      (value, path, issues) => {
        if (!(value instanceof Date)) {
          pushIssue(issues, "Expected Date", path);
          return value as Date;
        }

        if (Number.isNaN(value.getTime())) {
          pushIssue(issues, "Expected valid Date", path);
        }

        return value;
      },
      (_target, mode) => {
        if (mode === "input") {
          throw new UnsupportedJsonSchemaConversionError("date");
        }

        return { type: "string", format: "date-time" };
      },
    );
  }
}

export class LiteralSchema<T extends LiteralValue> extends Schema<T> {
  public readonly schemaType = "literal";

  public constructor(expected: T) {
    super(
      (value, path, issues) => {
        if (value !== expected) {
          pushIssue(issues, `Expected ${String(expected)}`, path);
        }

        return expected;
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
    const allowed = new Set(values);

    super(
      (value, path, issues) => {
        if (typeof value !== "string") {
          pushIssue(issues, "Expected string", path);
          return values[0] as T;
        }

        if (!allowed.has(value as T)) {
          pushIssue(issues, `Expected one of: ${values.join(", ")}`, path);
        }

        return value as T;
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
      (value, path, issues) => {
        if (value === undefined) {
          return undefined;
        }

        return inner.run(value, path, issues);
      },
      (target, mode) => {
        return childJsonSchema(inner, target, mode);
      },
    );
  }

  public override toInline(
    expr: string,
    pathPrefix: PropertyKey[],
    binds: unknown[],
    dynamicIndex?: string,
  ) {
    const inner = this.inner.toInline(expr, pathPrefix, binds, dynamicIndex);

    if (!inner) {
      return null;
    }

    return `if(${expr}!==undefined){${inner}}`;
  }
}

export class NullableSchema<Output> extends Schema<Output | null> {
  public readonly schemaType = "nullable";

  public constructor(public readonly inner: Schema<Output>) {
    super(
      (value, path, issues) => {
        if (value === null) {
          return null;
        }

        return inner.run(value, path, issues);
      },
      (target, mode) => {
        const base = childJsonSchema(inner, target, mode);

        return { anyOf: [base, { type: "null" }] };
      },
    );
  }
}

export class NullishSchema<Output> extends Schema<Output | null | undefined> {
  public readonly schemaType = "nullish";

  public constructor(public readonly inner: Schema<Output>) {
    super(
      (value, path, issues) => {
        if (value === null) {
          return null;
        }

        if (value === undefined) {
          return undefined;
        }

        return inner.run(value, path, issues);
      },
      (target, mode) => {
        const base = childJsonSchema(inner, target, mode);

        return { anyOf: [base, { type: "null" }] };
      },
    );
  }
}

export class ArraySchema<Output> extends Schema<Output[]> {
  public readonly schemaType = "array";

  private readonly bounds: ReadonlyArray<ArrayBound>;
  private readonly jsonExtras: JsonSchema;
  private readonly element: Schema<Output>;

  private constructor(
    element: Schema<Output>,
    bounds: ReadonlyArray<ArrayBound> = [],
    jsonExtras: JsonSchema = {},
  ) {
    const elementRun = element.run;

    super(
      (value, path, issues) => {
        if (!Array.isArray(value)) {
          pushIssue(issues, "Expected array", path);
          return value as Output[];
        }

        const list = value as Output[];
        const before = issues.length;

        for (let index = 0; index < list.length; index++) {
          path.push(index);
          elementRun(list[index], path, issues);
          path.pop();
        }

        if (issues.length > before) {
          return list;
        }

        for (let i = 0; i < bounds.length; i++) {
          const bound = bounds[i];

          if (!bound) {
            continue;
          }

          if (bound.kind === "min") {
            if (list.length < bound.length) {
              pushIssue(issues, bound.message, path);
              return list;
            }
            continue;
          }

          if (list.length > bound.length) {
            pushIssue(issues, bound.message, path);
            return list;
          }
        }

        return list;
      },
      (target, mode) => {
        return {
          type: "array",
          items: childJsonSchema(element, target, mode),
          ...jsonExtras,
        };
      },
    );

    this.element = element;
    this.bounds = bounds;
    this.jsonExtras = jsonExtras;
  }

  public static create<Output>(element: Schema<Output>) {
    return new ArraySchema(element);
  }

  private withBound(bound: ArrayBound, extras: JsonSchema) {
    return new ArraySchema(this.element, [...this.bounds, bound], {
      ...this.jsonExtras,
      ...extras,
    });
  }

  public override toInline(
    expr: string,
    pathPrefix: PropertyKey[],
    binds: unknown[],
    dynamicIndex?: string,
  ) {
    if (dynamicIndex !== undefined) {
      return null;
    }

    const elementInline = this.element.toInline(
      "__el",
      pathPrefix,
      binds,
      "__i",
    );

    if (!elementInline) {
      return null;
    }

    const pathExpr = formatPathExpr(pathPrefix);
    const parts = [
      `if(!Array.isArray(${expr})){${emitIssue('"Expected array"', pathExpr)}}else{`,
    ];

    for (let i = 0; i < this.bounds.length; i++) {
      const bound = this.bounds[i];

      if (!bound) {
        continue;
      }

      const msg = JSON.stringify(bound.message);

      if (bound.kind === "min") {
        parts.push(
          `if(${expr}.length<${bound.length}){${emitIssue(msg, pathExpr)}}`,
        );
        continue;
      }

      parts.push(
        `if(${expr}.length>${bound.length}){${emitIssue(msg, pathExpr)}}`,
      );
    }

    parts.push(
      `for(let __i=0;__i<${expr}.length;__i++){const __el=${expr}[__i];`,
      elementInline,
      "}}",
    );

    return parts.join("");
  }

  public min(length: number, message?: string) {
    return this.withBound(
      {
        kind: "min",
        length,
        message: message ?? `Expected array length >= ${length}`,
      },
      { minItems: length },
    );
  }

  public max(length: number, message?: string) {
    return this.withBound(
      {
        kind: "max",
        length,
        message: message ?? `Expected array length <= ${length}`,
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

  private readonly compiled: ReturnType<
    typeof compileObjectValidate<InferObjectOutput<Shape>>
  >;
  private readonly shape: Shape;

  public constructor(shape: Shape) {
    const fields: ObjectField[] = [];
    const keys = Object.keys(shape);

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];

      if (key === undefined) {
        continue;
      }

      const propertySchema = shape[key];

      if (!propertySchema) {
        continue;
      }

      fields.push({
        key,
        run: propertySchema.run,
        optional:
          propertySchema.schemaType === "optional" ||
          propertySchema.schemaType === "nullish",
        toInline: (expr, pathPrefix, binds, dynamicIndex) => {
          return propertySchema.toInline(expr, pathPrefix, binds, dynamicIndex);
        },
      });
    }

    const compiled = compileObjectValidate<InferObjectOutput<Shape>>(fields);

    super(compiled.run, (target, mode) => {
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];

        if (!field) {
          continue;
        }

        const propertySchema = shape[field.key];

        if (!propertySchema) {
          continue;
        }

        properties[field.key] = childJsonSchema(propertySchema, target, mode);

        if (field.optional) {
          continue;
        }

        required.push(field.key);
      }

      const schema: JsonSchema = {
        type: "object",
        properties,
      };

      if (required.length > 0) {
        schema.required = required;
      }

      return schema;
    });

    this.compiled = compiled;
    this.shape = shape;
  }

  private checkObject(value: unknown) {
    if (this.compiled.needsPath) {
      TLS_PATH.length = 0;
      this.compiled.run(value, TLS_PATH, TLS_ISSUES);
      return;
    }

    this.compiled.check(value, TLS_ISSUES);
  }

  public override validateStd(
    value: unknown,
  ): StandardSchemaV1.Result<InferObjectOutput<Shape>> {
    if (!tryEnterObjectTls()) {
      return super.validateStd(value);
    }

    try {
      this.checkObject(value);

      if (TLS_ISSUES.length > 0) {
        return { issues: TLS_ISSUES.slice() };
      }

      return { value: value as InferObjectOutput<Shape> };
    } finally {
      leaveObjectTls();
    }
  }

  public override parse(data: unknown): InferObjectOutput<Shape> {
    if (!tryEnterObjectTls()) {
      return super.parse(data);
    }

    try {
      this.checkObject(data);

      if (TLS_ISSUES.length > 0) {
        throw new SchemaError(TLS_ISSUES.slice());
      }

      return data as InferObjectOutput<Shape>;
    } finally {
      leaveObjectTls();
    }
  }

  public override safeParse(
    data: unknown,
  ): SafeParseResult<InferObjectOutput<Shape>> {
    if (!tryEnterObjectTls()) {
      return super.safeParse(data);
    }

    try {
      this.checkObject(data);

      if (TLS_ISSUES.length > 0) {
        const issues = TLS_ISSUES.slice();

        return {
          success: false,
          error: { issues, message: formatIssues(issues) },
        };
      }

      return {
        success: true,
        data: data as InferObjectOutput<Shape>,
      };
    } finally {
      leaveObjectTls();
    }
  }

  public override toInline(
    expr: string,
    pathPrefix: PropertyKey[],
    binds: unknown[],
    dynamicIndex?: string,
  ) {
    if (dynamicIndex !== undefined) {
      return null;
    }

    const keys = Object.keys(this.shape);
    const parts: string[] = [
      `if(typeof ${expr}!=='object'||${expr}===null||Array.isArray(${expr})){${emitIssue('"Expected object"', formatPathExpr(pathPrefix))}}else{`,
    ];

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];

      if (key === undefined) {
        continue;
      }

      const propertySchema = this.shape[key];

      if (!propertySchema) {
        continue;
      }

      const keyLiteral = JSON.stringify(key);
      const access = `${expr}[${keyLiteral}]`;
      const childPrefix = [...pathPrefix, key];
      const optional =
        propertySchema.schemaType === "optional" ||
        propertySchema.schemaType === "nullish";
      const inline = propertySchema.toInline(access, childPrefix, binds);

      parts.push(`if(!(${keyLiteral} in ${expr})){`);

      if (!optional) {
        parts.push(emitIssue('"Required"', formatPathExpr(childPrefix)));
      }

      if (inline) {
        parts.push("}else{", inline, "}");
        continue;
      }

      return null;
    }

    parts.push("}");
    return parts.join("");
  }
}

export class RecordSchema<Output> extends Schema<Record<string, Output>> {
  public readonly schemaType = "record";

  public constructor(valueSchema: Schema<Output>) {
    const valueRun = valueSchema.run;

    super(
      (value, path, issues) => {
        if (typeof value !== "object") {
          pushIssue(issues, "Expected object", path);
          return value as Record<string, Output>;
        }

        if (value === null) {
          pushIssue(issues, "Expected object", path);
          return value as unknown as Record<string, Output>;
        }

        if (Array.isArray(value)) {
          pushIssue(issues, "Expected object", path);
          return value as unknown as Record<string, Output>;
        }

        const record = value as Record<string, Output>;
        const keys = Object.keys(record);

        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];

          if (key === undefined) {
            continue;
          }

          path.push(key);
          valueRun(record[key], path, issues);
          path.pop();
        }

        return record;
      },
      (target, mode) => {
        return {
          type: "object",
          additionalProperties: childJsonSchema(valueSchema, target, mode),
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
    const itemRuns = items.map((item) => item.run);
    const length = items.length;

    super(
      (value, path, issues) => {
        if (!Array.isArray(value)) {
          pushIssue(issues, "Expected array", path);
          return value as { [K in keyof T]: InferOutput<T[K]> };
        }

        if (value.length !== length) {
          pushIssue(issues, `Expected tuple of length ${length}`, path);
          return value as { [K in keyof T]: InferOutput<T[K]> };
        }

        for (let index = 0; index < length; index++) {
          const itemRun = itemRuns[index];

          if (!itemRun) {
            continue;
          }

          path.push(index);
          itemRun(value[index], path, issues);
          path.pop();
        }

        return value as { [K in keyof T]: InferOutput<T[K]> };
      },
      (target, mode) => {
        return {
          type: "array",
          minItems: length,
          maxItems: length,
          prefixItems: items.map((item) => childJsonSchema(item, target, mode)),
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
    const optionRuns = options.map((option) => option.run);

    super(
      (value, path, issues) => {
        const localIssues: Issue[] = [];

        for (let i = 0; i < optionRuns.length; i++) {
          const optionRun = optionRuns[i];

          if (!optionRun) {
            continue;
          }

          localIssues.length = 0;
          const output = optionRun(value, path, localIssues);

          if (localIssues.length === 0) {
            return output as InferOutput<T[number]>;
          }
        }

        pushIssue(issues, "Invalid input", path);
        return value as InferOutput<T[number]>;
      },
      (target, mode) => {
        return {
          anyOf: options.map((option) => childJsonSchema(option, target, mode)),
        };
      },
    );
  }
}

export const string = () => StringSchema.create();

export const number = () => NumberSchema.create();

export const int = (message?: string) => number().int(message);

export const email = (message?: string) => string().email(message);

export const url = (message?: string) => string().url(message);

export const uuid = (message?: string) => string().uuid(message);

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
    (value) => value,
    () => {
      return {};
    },
  );
};

export const unknown = () => {
  return new LeafSchema<unknown>(
    "unknown",
    (value) => value,
    () => {
      return {};
    },
  );
};

export const never = () => {
  return new LeafSchema<never>(
    "never",
    (value, path, issues) => {
      pushIssue(issues, "Expected never", path);
      return value as never;
    },
    () => {
      return { not: {} };
    },
  );
};

export const nullType = () => {
  return new LeafSchema<null>(
    "null",
    (value, path, issues) => {
      if (value !== null) {
        pushIssue(issues, "Expected null", path);
      }

      return null;
    },
    () => {
      return { type: "null" };
    },
  );
};

export const undefinedType = () => {
  return new LeafSchema<undefined>(
    "undefined",
    (value, path, issues) => {
      if (value !== undefined) {
        pushIssue(issues, "Expected undefined", path);
      }

      return undefined;
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

/** Same helpers as a namespace. Prefer named imports for tree-shaking. */
export const s = {
  string,
  number,
  int,
  email,
  url,
  uuid,
  boolean,
  bigint,
  date,
  literal,
  enum: enumValues,
  array,
  object,
  record,
  tuple,
  union,
  optional,
  nullable,
  nullish,
  any,
  unknown,
  never,
  null: nullType,
  undefined: undefinedType,
  parse,
  safeParse,
};
