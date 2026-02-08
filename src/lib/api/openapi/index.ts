import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import type { OpenAPIV3_1 } from "openapi-types";
import type { RequestSchema, ResponseSchema } from "../core/types.js";
import type { Middleware } from "../middleware/index.js";
import type {
  OpenApiOperation,
  OpenApiParameter,
  OpenApiResponse,
  OpenApiSpec,
} from "./types.js";

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

const mergeRequestSchemas = (schemas: Array<RequestSchema | undefined>) => {
  const merged: RequestSchema = {};

  for (const schema of schemas) {
    if (!schema) {
      continue;
    }

    for (const field of requestFields) {
      if (schema[field]) {
        merged[field] = schema[field];
      }
    }
  }

  return merged;
};

const mergeResponseSchemas = (schemas: Array<ResponseSchema | undefined>) => {
  const merged: ResponseSchema = {};

  for (const schema of schemas) {
    if (!schema) {
      continue;
    }

    for (const status in schema) {
      const statusCode = Number(status);
      const responseSchema = schema[statusCode];

      if (responseSchema) {
        merged[statusCode] = responseSchema;
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
};

type JsonSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

const convertSchemaToOpenApi = async (
  schema: StandardSchemaV1,
  io: "input" | "output" = "input",
) => {
  const result = toOpenAPISchema(schema, io);
  return result as {
    schema: JsonSchema;
    components?: OpenAPIV3_1.ComponentsObject;
  };
};

const extractParametersFromSchema = async (
  schema: StandardSchemaV1,
  location: "query" | "header" | "cookie",
) => {
  const { schema: jsonSchema, components } =
    await convertSchemaToOpenApi(schema);

  if (jsonSchema.type !== "object") {
    return { parameters: [], components };
  }

  if (!jsonSchema.properties) {
    return { parameters: [], components };
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

  return { parameters, components };
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

const createParameters = async (request: RequestSchema, path: string) => {
  const parameters: OpenApiParameter[] = [];
  const allComponents: Array<OpenAPIV3_1.ComponentsObject | undefined> = [];

  for (const [field, location] of paramSources) {
    if (request[field]) {
      const { parameters: params, components } =
        await extractParametersFromSchema(request[field], location);
      parameters.push(...params);
      if (components) {
        allComponents.push(components);
      }
    }
  }

  const pathParamNames = extractPathParameters(path);

  if (pathParamNames.length > 0 && request.params) {
    const { schema: jsonSchema, components } = await convertSchemaToOpenApi(
      request.params,
    );

    if (components) {
      allComponents.push(components);
    }

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

  return { parameters, components: allComponents };
};

const createRequestBody = async (bodySchema: StandardSchemaV1) => {
  const { schema, components } = await convertSchemaToOpenApi(bodySchema);

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

const createResponses = async (response?: ResponseSchema) => {
  const responses: Record<string, OpenApiResponse> = {};
  const allComponents: Array<OpenAPIV3_1.ComponentsObject | undefined> = [];

  if (!response) {
    return { responses, components: allComponents };
  }

  for (const status in response) {
    const statusCode = String(status);
    const schema = response[Number(status)];

    if (!schema) {
      continue;
    }

    const description = getSchemaDescription(schema);
    const { schema: jsonSchema, components } = await convertSchemaToOpenApi(
      schema,
      "output",
    );

    if (components) {
      allComponents.push(components);
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

  return { responses, components: allComponents };
};

const createOperation = async (
  route: RouteConfigInternal,
  globalMiddlewares: readonly Middleware[],
  prefix?: string,
) => {
  const allMiddlewares = [
    ...(globalMiddlewares ?? []),
    ...(route.middlewares ?? []),
  ];

  const requestSchemas: Array<RequestSchema | undefined> = [];
  const responseSchemas: Array<ResponseSchema | undefined> = [];

  for (const middleware of allMiddlewares) {
    requestSchemas.push(middleware.options.request);
    responseSchemas.push(middleware.options.response);
  }

  requestSchemas.push(route.request);
  responseSchemas.push(route.response);

  const mergedRequest = mergeRequestSchemas(requestSchemas);
  const mergedResponse = mergeResponseSchemas(responseSchemas);

  const fullPath = prefix ? prefix + route.path : route.path;
  const { parameters, components: parameterComponents } =
    await createParameters(mergedRequest, fullPath);
  const { responses, components: responseComponents } =
    await createResponses(mergedResponse);

  const operation: OpenApiOperation = {
    responses,
  };

  const allComponents: Array<OpenAPIV3_1.ComponentsObject | undefined> = [];
  allComponents.push(...responseComponents);
  allComponents.push(...parameterComponents);

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

  const bodySchema = mergedRequest.body;

  if (bodySchema) {
    const { requestBody, components: bodyComponents } =
      await createRequestBody(bodySchema);
    operation.requestBody = requestBody;
    if (bodyComponents) {
      allComponents.push(bodyComponents);
    }
  }

  return { operation, components: allComponents };
};

const componentKeys = [
  "schemas",
  "responses",
  "parameters",
  "requestBodies",
] as const;

// Merges multiple ComponentsObject into a single object
// Handles deduplication by merging schemas with the same name
const mergeComponents = (
  componentsArray: Array<OpenAPIV3_1.ComponentsObject | undefined>,
): OpenAPIV3_1.ComponentsObject => {
  const merged: Record<string, Record<string, unknown>> = {};

  for (const components of componentsArray) {
    if (!components) {
      continue;
    }

    for (const key of componentKeys) {
      if (components[key]) {
        merged[key] = { ...merged[key], ...components[key] };
      }
    }
  }

  return merged;
};

export const generateOpenApiSpec = async (options: OpenApiGeneratorOptions) => {
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

  if (options.securitySchemes) {
    spec.components = {
      securitySchemes: options.securitySchemes,
    };
  }

  const allRouteComponents: Array<OpenAPIV3_1.ComponentsObject | undefined> =
    [];

  for (const route of options.routes) {
    const fullPath = options.prefix ? options.prefix + route.path : route.path;
    const openApiPath = normalizePathForOpenAPI(fullPath);
    const method = route.method.toLowerCase();

    if (!spec.paths[openApiPath]) {
      spec.paths[openApiPath] = {};
    }

    const { operation, components } = await createOperation(
      route,
      options.globalMiddlewares ?? [],
      options.prefix,
    );

    spec.paths[openApiPath][method] = operation;
    allRouteComponents.push(...components);
  }

  // Merge all components into spec
  const mergedComponents = mergeComponents(allRouteComponents);

  if (!spec.components) {
    spec.components = {};
  }

  // Merge with existing security schemes
  if (options.securitySchemes) {
    spec.components.securitySchemes = options.securitySchemes;
  }

  // Add collected component types if present
  for (const key of componentKeys) {
    const value = mergedComponents[key];

    if (value && Object.keys(value).length > 0) {
      spec.components[key] = value;
    }
  }

  return spec;
};
