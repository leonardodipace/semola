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
} from "../types.js";

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

const rewriteSchemaMap = (
  value: unknown,
  schemas: Record<string, JsonSchema>,
) => {
  if (typeof value !== "object") return value;
  if (value === null) return value;

  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};

  for (const name in record) {
    next[name] = rewriteSchemaTree(record[name], schemas);
  }

  return next;
};

const hoistDefsIntoSchemas = (
  defs: unknown,
  schemas: Record<string, JsonSchema>,
) => {
  if (typeof defs !== "object") return;
  if (defs === null) return;

  const defsRecord = defs as Record<string, unknown>;

  for (const name in defsRecord) {
    schemas[name] = rewriteSchemaTree(
      defsRecord[name],
      schemas,
      true,
    ) as JsonSchema;
  }
};

const rewriteSchemaTree = (
  value: unknown,
  schemas: Record<string, JsonSchema>,
  isRoot = false,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteSchemaTree(item, schemas));
  }

  if (typeof value !== "object") return value;
  if (value === null) return value;

  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};

  for (const key in record) {
    if (key === "$defs") {
      hoistDefsIntoSchemas(record.$defs, schemas);
      continue;
    }

    if (key === "$ref") {
      const ref = record.$ref;

      if (typeof ref === "string" && ref.startsWith("#/$defs/")) {
        next.$ref = `#/components/schemas/${ref.slice("#/$defs/".length)}`;
        continue;
      }

      next.$ref = ref;
      continue;
    }

    if (schemaMapKeys.has(key)) {
      next[key] = rewriteSchemaMap(record[key], schemas);
      continue;
    }

    if (instanceDataKeys.has(key)) {
      next[key] = record[key];
      continue;
    }

    next[key] = rewriteSchemaTree(record[key], schemas);
  }

  if (isRoot) return next;
  if (typeof next.id !== "string") return next;

  const id = next.id;
  const definition = { ...next };
  delete definition.id;
  delete definition.$schema;
  schemas[id] = definition as JsonSchema;

  return { $ref: `#/components/schemas/${id}` };
};

const toJsonSchema = (
  schema: StandardSchemaV1,
  schemas: Record<string, JsonSchema>,
  io: SchemaIo = "input",
) => {
  const jsonSchema = (schema as unknown as StandardJSONSchemaV1)[
    "~standard"
  ].jsonSchema[io]({ target: "draft-2020-12" });

  return rewriteSchemaTree(jsonSchema, schemas, true) as JsonSchema;
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
  schemas: Record<string, JsonSchema>,
  io: SchemaIo = "input",
) => {
  const jsonSchema = toJsonSchema(schema, schemas, io);
  const schemaId = getSchemaId(schema, jsonSchema);

  if (!schemaId) return withoutMeta(jsonSchema);

  schemas[schemaId] = withoutMeta(jsonSchema);

  return { $ref: `#/components/schemas/${schemaId}` };
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
  schemas: Record<string, JsonSchema>,
) => {
  const jsonSchema = withoutMeta(toJsonSchema(schema, schemas));
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
  schemas: Record<string, JsonSchema>,
) => {
  const parameters: OpenApiParameter[] = [];

  for (const [field, location] of paramSources) {
    const schema = request[field];

    if (schema) {
      parameters.push(
        ...extractParametersFromSchema(schema, location, schemas),
      );
    }
  }

  const pathParamNames = extractPathParameters(path);

  if (pathParamNames.length === 0) return parameters;
  if (!request.params) return parameters;

  for (const parameter of extractParametersFromSchema(
    request.params,
    "path",
    schemas,
  )) {
    if (pathParamNames.includes(parameter.name)) {
      parameters.push({ ...parameter, required: true });
    }
  }

  return parameters;
};

const createResponses = (
  schemas: Record<string, JsonSchema>,
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
          schema: toSchemaRef(schema, schemas, "output"),
        },
      },
    };
  }

  return responses;
};

const createOperation = (
  route: RouteConfigInternal,
  schemas: Record<string, JsonSchema>,
  errorResponses?: ResponseSchema,
) => {
  const { request, response } = createRouteSchemas(route, errorResponses);

  const operation: OpenApiOperation = {
    responses: createResponses(schemas, response),
  };

  const parameters = createParameters(request, route.path, schemas);

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
          schema: toSchemaRef(request.body, schemas),
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

  const schemas: Record<string, JsonSchema> = {};

  for (const route of options.routes) {
    const openApiPath = normalizePathForOpenAPI(route.path);
    const method = route.method.toLowerCase();

    spec.paths[openApiPath] ??= {};
    spec.paths[openApiPath][method] = createOperation(
      route,
      schemas,
      options.errorResponses,
    );
  }

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
