import { toOpenAPISchema } from "@standard-community/standard-openapi";
import type { StandardSchemaV1 } from "@standard-schema/spec";
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
  response: ResponseSchema;
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

const mergeRequestSchemas = (schemas: Array<RequestSchema | undefined>) => {
  const merged: RequestSchema = {};

  for (const schema of schemas) {
    if (!schema) {
      continue;
    }

    if (schema.body) {
      merged.body = schema.body;
    }

    if (schema.query) {
      merged.query = schema.query;
    }

    if (schema.headers) {
      merged.headers = schema.headers;
    }

    if (schema.cookies) {
      merged.cookies = schema.cookies;
    }

    if (schema.params) {
      merged.params = schema.params;
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

  return merged;
};

const convertSchemaToOpenApi = async (schema: StandardSchemaV1) => {
  const result = await toOpenAPISchema(schema);
  return result;
};

const extractParametersFromSchema = async (
  schema: StandardSchemaV1,
  location: "query" | "header" | "cookie",
) => {
  const jsonSchema = (await convertSchemaToOpenApi(schema)) as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };

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

const extractPathParameters = (path: string) => {
  const matches = path.match(/:([a-zA-Z_][a-zA-Z0-9_]*)/g);

  if (!matches) {
    return [];
  }

  return matches.map((match) => match.slice(1));
};

const createParameters = async (request: RequestSchema, path: string) => {
  const parameters: OpenApiParameter[] = [];

  if (request.query) {
    const queryParams = await extractParametersFromSchema(
      request.query,
      "query",
    );
    parameters.push(...queryParams);
  }

  if (request.headers) {
    const headerParams = await extractParametersFromSchema(
      request.headers,
      "header",
    );
    parameters.push(...headerParams);
  }

  if (request.cookies) {
    const cookieParams = await extractParametersFromSchema(
      request.cookies,
      "cookie",
    );
    parameters.push(...cookieParams);
  }

  const pathParamNames = extractPathParameters(path);

  if (pathParamNames.length > 0) {
    if (!request.params) {
      return parameters;
    }

    const jsonSchema = (await convertSchemaToOpenApi(request.params)) as {
      type?: string;
      properties?: Record<string, unknown>;
    };

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

const createRequestBody = async (bodySchema: StandardSchemaV1) => {
  const schema = await convertSchemaToOpenApi(bodySchema);

  return {
    required: true,
    content: {
      "application/json": {
        schema,
      },
    },
  };
};

const createResponses = async (response: ResponseSchema) => {
  const responses: Record<string, OpenApiResponse> = {};

  for (const status in response) {
    const statusCode = String(status);
    const schema = response[Number(status)];

    if (!schema) {
      continue;
    }

    const description = getSchemaDescription(schema);
    const jsonSchema = await convertSchemaToOpenApi(schema);

    responses[statusCode] = {
      description: description || `Response with status ${statusCode}`,
      content: {
        "application/json": jsonSchema,
      },
    };
  }

  return responses;
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
  const parameters = await createParameters(mergedRequest, fullPath);
  const responses = await createResponses(mergedResponse);

  const operation: OpenApiOperation = {
    responses,
  };

  if (route.summary) {
    operation.summary = route.summary;
  }

  if (route.description) {
    operation.description = route.description;
  }

  if (route.operationId) {
    operation.operationId = route.operationId;
  }

  if (route.tags && route.tags.length > 0) {
    operation.tags = route.tags;
  }

  if (parameters.length > 0) {
    operation.parameters = parameters;
  }

  const bodySchema = mergedRequest.body;

  if (bodySchema) {
    const requestBody = await createRequestBody(bodySchema);
    operation.requestBody = requestBody;
  }

  return operation;
};

export const generateOpenApiSpec = async (options: OpenApiGeneratorOptions) => {
  const spec: OpenApiSpec = {
    openapi: "3.0.3",
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

  for (const route of options.routes) {
    const fullPath = options.prefix ? options.prefix + route.path : route.path;
    const method = route.method.toLowerCase();

    if (!spec.paths[fullPath]) {
      spec.paths[fullPath] = {};
    }

    const operation = await createOperation(
      route,
      options.globalMiddlewares ?? [],
      options.prefix,
    );

    spec.paths[fullPath][method] = operation;
  }

  return spec;
};
