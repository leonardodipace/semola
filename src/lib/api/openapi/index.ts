import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import type { RequestSchema, ResponseSchema } from "../core/types.js";
import type { Middleware } from "../middleware/index.js";
import type {
  OpenApiOperation,
  OpenApiParameter,
  OpenApiResponse,
  OpenApiSpec,
} from "./types.js";

type OpenApiComponents = NonNullable<OpenApiSpec["components"]>;

type RouteConfigInternal = {
  path: string;
  method: string;
  request?: RequestSchema;
  response?: ResponseSchema;
  middlewares?: readonly Middleware[];
  handler: unknown;
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
};

type OpenApiGeneratorOptions = {
  title: string;
  description?: string;
  version: string;
  prefix?: string;
  servers?: Array<{ url: string; description?: string }>;
  securitySchemes?: Record<string, unknown>;
  routes: RouteConfigInternal[];
  globalMiddlewares?: readonly Middleware[];
};

const toOpenAPISchema = (
  schema: StandardSchemaV1,
  io: "input" | "output" = "input",
) => ({
  schema: (schema as unknown as StandardJSONSchemaV1)["~standard"].jsonSchema[
    io
  ]({ target: "draft-2020-12" }),
});

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

const requestFields = [
  "body",
  "query",
  "headers",
  "cookies",
  "params",
] as const;

type JsonSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

const convertSchemaToOpenApi = (
  schema: StandardSchemaV1,
  io: "input" | "output" = "input",
) => {
  const result = toOpenAPISchema(schema, io);
  const { schema: jsonSchema } = result as {
    schema: JsonSchema;
    components?: OpenApiComponents;
  };

  // Check if schema has an id (from .meta({ id: "..." }))
  const schemaId = jsonSchema.id;

  if (schemaId && typeof schemaId === "string") {
    // Extract to components and return a reference
    const schemaWithoutId = { ...jsonSchema };
    delete schemaWithoutId.id;
    delete schemaWithoutId.$schema;

    return {
      schema: { $ref: `#/components/schemas/${schemaId}` },
      components: {
        schemas: {
          [schemaId]: schemaWithoutId,
        },
      } as OpenApiComponents,
    };
  }

  // Remove $schema from inline schemas
  if (jsonSchema.$schema) {
    const schemaWithoutMeta = { ...jsonSchema };
    delete schemaWithoutMeta.$schema;
    return {
      schema: schemaWithoutMeta,
      components: undefined,
    };
  }

  return result as {
    schema: JsonSchema;
    components?: OpenApiComponents;
  };
};

// Convert schema to inline JSON schema (for parameters that don't support $ref)
const convertSchemaToInlineOpenApi = (
  schema: StandardSchemaV1,
  io: "input" | "output" = "input",
) => {
  const result = toOpenAPISchema(schema, io);
  const { schema: jsonSchema } = result as { schema: JsonSchema };

  // Remove $schema and id from inline schemas
  const cleanSchema = { ...jsonSchema };
  delete cleanSchema.$schema;
  delete cleanSchema.id;

  return {
    schema: cleanSchema,
  };
};

const extractParametersFromSchema = (
  schema: StandardSchemaV1,
  location: "query" | "header" | "cookie",
) => {
  const { schema: jsonSchema } = convertSchemaToInlineOpenApi(schema);

  if (jsonSchema.type !== "object") {
    return [];
  }

  if (!jsonSchema.properties) {
    return [];
  }

  const parameters: OpenApiParameter[] = [];
  const requiredFields = jsonSchema.required ?? [];

  for (const name in jsonSchema.properties) {
    const propertySchema = jsonSchema.properties[name];
    const isRequired = requiredFields.includes(name);

    parameters.push({
      name,
      in: location,
      required: isRequired,
      schema: propertySchema,
    });
  }

  return parameters;
};

const normalizePathForOpenAPI = (path: string) => {
  // Convert Bun-style path parameters (:param) to OpenAPI syntax ({param})
  return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, "{$1}");
};

const extractPathParameters = (path: string) => {
  const matches = path.match(/:([a-zA-Z_][a-zA-Z0-9_]*)/g);

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

const createParameters = (request: RequestSchema, path: string) => {
  const parameters: OpenApiParameter[] = [];

  for (const [field, location] of paramSources) {
    if (request[field]) {
      parameters.push(...extractParametersFromSchema(request[field], location));
    }
  }

  const pathParamNames = extractPathParameters(path);

  if (pathParamNames.length > 0 && request.params) {
    const { schema: jsonSchema } = convertSchemaToInlineOpenApi(request.params);

    if (jsonSchema.type === "object" && jsonSchema.properties) {
      for (const name of pathParamNames) {
        const propertySchema = jsonSchema.properties[name];

        if (propertySchema) {
          parameters.push({
            name,
            in: "path",
            required: true,
            schema: propertySchema,
          });
        }
      }
    }
  }

  return parameters;
};

const createRequestBody = (bodySchema: StandardSchemaV1) => {
  const { schema, components } = convertSchemaToOpenApi(bodySchema);

  return {
    components,
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema,
        },
      },
    },
  };
};

const createResponses = (response?: ResponseSchema) => {
  const responses: Record<string, OpenApiResponse> = {};
  const components: OpenApiComponents[] = [];

  if (!response) {
    return { responses, components };
  }

  for (const status in response) {
    const statusCode = String(status);
    const schema = response[Number(status)];

    if (!schema) {
      continue;
    }

    const description = getSchemaDescription(schema);
    const { schema: jsonSchema, components: responseComponents } =
      convertSchemaToOpenApi(schema, "output");

    if (responseComponents) {
      components.push(responseComponents);
    }

    responses[statusCode] = {
      description: description || `Response with status ${statusCode}`,
      content: {
        "application/json": {
          schema: jsonSchema,
        },
      },
    };
  }

  return { responses, components };
};

const createOperation = (
  route: RouteConfigInternal,
  globalMiddlewares: readonly Middleware[],
  prefix?: string,
) => {
  const { request, response } = createRouteSchemas(route, globalMiddlewares);

  let fullPath = route.path;

  if (prefix) {
    fullPath = prefix + route.path;
  }

  const parameters = createParameters(request, fullPath);
  const { responses, components: responseComponents } =
    createResponses(response);

  const operation: OpenApiOperation = {
    responses,
  };

  const allComponents: OpenApiComponents[] = [];
  allComponents.push(...responseComponents);

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

  const bodySchema = request.body;

  if (bodySchema) {
    const { requestBody, components: bodyComponents } =
      createRequestBody(bodySchema);
    operation.requestBody = requestBody;
    if (bodyComponents) {
      allComponents.push(bodyComponents);
    }
  }

  return { operation, components: allComponents };
};

const createRouteSchemas = (
  route: RouteConfigInternal,
  globalMiddlewares: readonly Middleware[],
) => {
  const request: RequestSchema = {};
  const response: ResponseSchema = {};

  for (const middleware of [
    ...globalMiddlewares,
    ...(route.middlewares ?? []),
  ]) {
    mergeIntoRequest(request, middleware.options.request);
    mergeIntoResponse(response, middleware.options.response);
  }

  mergeIntoRequest(request, route.request);
  mergeIntoResponse(response, route.response);

  let routeResponse: ResponseSchema | undefined;

  if (Object.keys(response).length > 0) {
    routeResponse = response;
  }

  return {
    request,
    response: routeResponse,
  };
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

  const schemas: Record<string, unknown> = {};

  for (const route of options.routes) {
    let fullPath = route.path;

    if (options.prefix) {
      fullPath = options.prefix + route.path;
    }

    const openApiPath = normalizePathForOpenAPI(fullPath);
    const method = route.method.toLowerCase();

    spec.paths[openApiPath] ??= {};

    const { operation, components } = createOperation(
      route,
      options.globalMiddlewares ?? [],
      options.prefix,
    );

    spec.paths[openApiPath][method] = operation;

    components.forEach((component) => {
      Object.assign(schemas, component.schemas ?? {});
    });
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
