import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import type {
  JsonSchema,
  OpenApiGeneratorOptions,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiResponse,
  OpenApiSpec,
  RequestSchema,
  ResponseSchema,
  RouteConfigInternal,
  SchemaIo,
  SchemaRegistry,
  SchemaScope,
} from "../types.js";

const COMPONENT_REF_PREFIX = "#/components/schemas/";
const DEFS_REF_PREFIX = "#/$defs/";

const instanceDataKeys = new Set([
  "default",
  "enum",
  "const",
  "examples",
  "example",
]);

// Maps whose keys are names, not JSON Schema keywords.
const schemaMapKeys = new Set([
  "properties",
  "patternProperties",
  "dependentSchemas",
]);

const createComponentRef = (name: string, scope: SchemaScope) => {
  const ref: JsonSchema = { $ref: `${COMPONENT_REF_PREFIX}${name}` };
  scope.refs.push(ref);

  return ref;
};

const rewriteSchemaMap = (value: unknown, scope: SchemaScope) => {
  if (typeof value !== "object") return value;
  if (value === null) return value;

  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};

  for (const name in record) {
    next[name] = rewriteSchemaTree(record[name], scope);
  }

  return next;
};

const hoistDefsIntoSchemas = (defs: unknown, scope: SchemaScope) => {
  if (typeof defs !== "object") return;
  if (defs === null) return;

  const defsRecord = defs as Record<string, unknown>;

  for (const name in defsRecord) {
    scope.schemas[name] = rewriteSchemaTree(
      defsRecord[name],
      scope,
      true,
    ) as JsonSchema;
  }
};

const rewriteSchemaTree = (
  value: unknown,
  scope: SchemaScope,
  isRoot = false,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteSchemaTree(item, scope));
  }

  if (typeof value !== "object") return value;
  if (value === null) return value;

  const record = value as Record<string, unknown>;
  const next: JsonSchema = {};

  for (const key in record) {
    if (key === "$defs") {
      hoistDefsIntoSchemas(record.$defs, scope);
      continue;
    }

    if (key === "$ref") {
      const ref = record.$ref;

      if (typeof ref === "string" && ref.startsWith(DEFS_REF_PREFIX)) {
        next.$ref = `${COMPONENT_REF_PREFIX}${ref.slice(DEFS_REF_PREFIX.length)}`;
        scope.refs.push(next);
        continue;
      }

      next.$ref = ref;
      continue;
    }

    if (schemaMapKeys.has(key)) {
      next[key] = rewriteSchemaMap(record[key], scope);
      continue;
    }

    if (instanceDataKeys.has(key)) {
      next[key] = record[key];
      continue;
    }

    next[key] = rewriteSchemaTree(record[key], scope);
  }

  if (isRoot) return next;
  if (typeof next.id !== "string") return next;

  const id = next.id;
  const definition = { ...next };
  delete definition.id;
  delete definition.$schema;
  scope.schemas[id] = definition;

  return createComponentRef(id, scope);
};

const toJsonSchema = (
  schema: StandardSchemaV1,
  registry: SchemaRegistry,
  io: SchemaIo = "input",
) => {
  const jsonSchema = (schema as unknown as StandardJSONSchemaV1)[
    "~standard"
  ].jsonSchema[io]({ target: "draft-2020-12" });

  return rewriteSchemaTree(jsonSchema, registry[io], true) as JsonSchema;
};

const withoutMeta = (jsonSchema: JsonSchema) => {
  const clean = { ...jsonSchema };
  delete clean.id;
  delete clean.$schema;

  return clean;
};

const getSchemaDescription = (schema: StandardSchemaV1) => {
  const metadata = schema["~standard"];

  if (!metadata) {
    return "";
  }

  if ("description" in metadata && typeof metadata.description === "string") {
    return metadata.description;
  }

  return "";
};

const getDeclaredSchemaId = (schema: StandardSchemaV1 & { meta?: unknown }) => {
  const readMeta = schema.meta;

  if (typeof readMeta !== "function") return;

  const meta = readMeta();

  if (typeof meta !== "object") return;
  if (meta === null) return;
  if (typeof meta.id !== "string") return;

  return meta.id;
};

const getSchemaId = (schema: StandardSchemaV1, jsonSchema: JsonSchema) => {
  if (typeof jsonSchema.id === "string") {
    return jsonSchema.id;
  }

  return getDeclaredSchemaId(schema);
};

// Body and response schemas with an id become shared components.
const toSchemaRef = (
  schema: StandardSchemaV1,
  registry: SchemaRegistry,
  io: SchemaIo = "input",
) => {
  const jsonSchema = toJsonSchema(schema, registry, io);
  const schemaId = getSchemaId(schema, jsonSchema);

  if (!schemaId) return withoutMeta(jsonSchema);

  const scope = registry[io];
  scope.schemas[schemaId] = withoutMeta(jsonSchema);

  return createComponentRef(schemaId, scope);
};

const requestFields = [
  "body",
  "query",
  "headers",
  "cookies",
  "params",
] as const;

const extractParametersFromSchema = (
  schema: StandardSchemaV1,
  location: OpenApiParameter["in"],
  registry: SchemaRegistry,
) => {
  const jsonSchema = withoutMeta(toJsonSchema(schema, registry));
  const parameters: OpenApiParameter[] = [];

  if (jsonSchema.type !== "object") return parameters;
  if (!jsonSchema.properties) return parameters;

  const requiredFields = jsonSchema.required ?? [];

  for (const name in jsonSchema.properties) {
    parameters.push({
      name,
      in: location,
      required: requiredFields.includes(name),
      schema: jsonSchema.properties[name],
    });
  }

  return parameters;
};

const PATH_PARAM = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;

const normalizePathForOpenAPI = (path: string) => {
  return path.replace(PATH_PARAM, "{$1}");
};

const extractPathParameters = (path: string) => {
  const matches = path.match(PATH_PARAM);

  if (!matches) {
    return [];
  }

  return matches.map((match) => match.slice(1));
};

const paramSources = [
  ["query", "query"],
  ["headers", "header"],
  ["cookies", "cookie"],
] as const;

const createParameters = (
  request: RequestSchema,
  path: string,
  registry: SchemaRegistry,
) => {
  const parameters: OpenApiParameter[] = [];

  for (const [field, location] of paramSources) {
    const schema = request[field];

    if (schema) {
      parameters.push(
        ...extractParametersFromSchema(schema, location, registry),
      );
    }
  }

  const pathParamNames = extractPathParameters(path);

  if (pathParamNames.length === 0) return parameters;
  if (!request.params) return parameters;

  for (const parameter of extractParametersFromSchema(
    request.params,
    "path",
    registry,
  )) {
    if (pathParamNames.includes(parameter.name)) {
      parameters.push({ ...parameter, required: true });
    }
  }

  return parameters;
};

const createResponses = (
  registry: SchemaRegistry,
  response: ResponseSchema,
) => {
  const responses: Record<string, OpenApiResponse> = {};

  for (const status in response) {
    const schema = response[Number(status)];

    if (!schema) {
      continue;
    }

    const description = getSchemaDescription(schema);

    responses[status] = {
      description: description || `Response with status ${status}`,
      content: {
        "application/json": {
          schema: toSchemaRef(schema, registry, "output"),
        },
      },
    };
  }

  return responses;
};

const createOperation = (
  route: RouteConfigInternal,
  registry: SchemaRegistry,
  errorResponses?: ResponseSchema,
) => {
  const { request, response } = createRouteSchemas(route, errorResponses);

  const operation: OpenApiOperation = {
    responses: createResponses(registry, response),
  };

  const parameters = createParameters(request, route.path, registry);

  for (const field of ["summary", "description", "operationId"] as const) {
    if (route[field]) {
      operation[field] = route[field];
    }
  }

  if (route.tags && route.tags.length > 0) {
    operation.tags = route.tags;
  }

  if (parameters.length > 0) {
    operation.parameters = parameters;
  }

  if (request.body) {
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: toSchemaRef(request.body, registry),
        },
      },
    };
  }

  return operation;
};

const createRouteSchemas = (
  route: RouteConfigInternal,
  errorResponses?: ResponseSchema,
) => {
  const request: RequestSchema = {};
  const response: ResponseSchema = {};

  mergeIntoResponse(response, errorResponses);

  for (const middleware of route.middlewares ?? []) {
    mergeIntoRequest(request, middleware.options.request);
    mergeIntoResponse(response, middleware.options.response);
  }

  mergeIntoRequest(request, route.request);
  mergeIntoResponse(response, route.response);

  return { request, response };
};

const mergeIntoRequest = (
  target: RequestSchema,
  schema: RequestSchema | undefined,
) => {
  if (!schema) {
    return;
  }

  for (const field of requestFields) {
    if (schema[field]) {
      target[field] = schema[field];
    }
  }
};

const mergeIntoResponse = (target: ResponseSchema, schema?: ResponseSchema) => {
  if (!schema) {
    return;
  }

  for (const status in schema) {
    const statusCode = Number(status);
    const responseSchema = schema[statusCode];

    if (responseSchema) {
      target[statusCode] = responseSchema;
    }
  }
};

const toComponentName = (ref: unknown) => {
  return String(ref).slice(COMPONENT_REF_PREFIX.length);
};

const referencesAnyName = (value: unknown, names: Set<string>) => {
  if (typeof value !== "object") return false;
  if (value === null) return false;

  const record = value as Record<string, unknown>;

  for (const key in record) {
    if (key === "$ref") {
      if (names.has(toComponentName(record.$ref))) return true;

      continue;
    }

    if (referencesAnyName(record[key], names)) return true;
  }

  return false;
};

// A name used in both directions diverges when its output shape differs from
// its input shape, directly or through a component it references.
const findDivergentNames = (registry: SchemaRegistry) => {
  const inputSchemas = registry.input.schemas;
  const outputSchemas = registry.output.schemas;
  const divergent = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;

    for (const name in outputSchemas) {
      if (divergent.has(name)) continue;

      const inputSchema = inputSchemas[name];
      const outputSchema = outputSchemas[name];

      if (!inputSchema) continue;

      if (Bun.deepEquals(inputSchema, outputSchema)) {
        if (!referencesAnyName(outputSchema, divergent)) continue;
      }

      divergent.add(name);
      changed = true;
    }
  }

  return divergent;
};

const toOutputName = (name: string, divergent: Set<string>) => {
  if (divergent.has(name)) return `${name}Output`;

  return name;
};

const mergeSchemaRegistry = (registry: SchemaRegistry) => {
  const divergent = findDivergentNames(registry);
  const schemas = { ...registry.input.schemas };

  for (const [name, schema] of Object.entries(registry.output.schemas)) {
    schemas[toOutputName(name, divergent)] = schema;
  }

  for (const ref of registry.output.refs) {
    const name = toOutputName(toComponentName(ref.$ref), divergent);
    ref.$ref = `${COMPONENT_REF_PREFIX}${name}`;
  }

  return schemas;
};

export const generateOpenApiSpec = (options: OpenApiGeneratorOptions) => {
  const spec: OpenApiSpec = {
    openapi: "3.1.0",
    info: {
      title: options.title,
      description: options.description,
      version: options.version,
    },
    paths: {},
  };

  if (options.servers && options.servers.length > 0) {
    spec.servers = options.servers;
  }

  const registry: SchemaRegistry = {
    input: { schemas: {}, refs: [] },
    output: { schemas: {}, refs: [] },
  };

  for (const route of options.routes) {
    const openApiPath = normalizePathForOpenAPI(route.path);
    const method = route.method.toLowerCase();

    spec.paths[openApiPath] ??= {};
    spec.paths[openApiPath][method] = createOperation(
      route,
      registry,
      options.errorResponses,
    );
  }

  const schemas = mergeSchemaRegistry(registry);
  const hasSchemas = Object.keys(schemas).length > 0;

  if (options.securitySchemes || hasSchemas) {
    spec.components = {};

    if (options.securitySchemes) {
      spec.components.securitySchemes = options.securitySchemes;
    }

    if (hasSchemas) {
      spec.components.schemas = schemas;
    }
  }

  return spec;
};
