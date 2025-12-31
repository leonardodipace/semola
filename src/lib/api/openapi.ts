import { toOpenAPISchema } from "@standard-community/standard-openapi";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ApiOptions, InternalRoute } from "./types.js";

export type OpenApiSpec = {
  openapi: string;
  info: {
    title: string;
    description?: string;
    version: string;
  };
  paths: Record<string, Record<string, unknown>>;
};

const addSchemaParameters = async (
  schema: StandardSchemaV1,
  location: "path" | "query" | "header" | "cookie",
  parameters: unknown[],
) => {
  const result = await toOpenAPISchema(schema);
  const openApiSchema = result.schema;

  if (!openApiSchema.properties) {
    return;
  }

  for (const [name, propSchema] of Object.entries(openApiSchema.properties)) {
    const required =
      location === "path" ||
      (Array.isArray(openApiSchema.required) &&
        openApiSchema.required.includes(name));

    parameters.push({
      name,
      in: location,
      required,
      schema: propSchema,
    });
  }
};

export const generateOpenApiSpec = async (
  routes: InternalRoute[],
  options: ApiOptions,
) => {
  const spec: OpenApiSpec = {
    openapi: "3.0.3",
    info: {
      title: options.openapi?.title ?? "API",
      description: options.openapi?.description,
      version: options.openapi?.version ?? "1.0.0",
    },
    paths: {},
  };

  for (const route of routes) {
    const { definition, path } = route;
    const openapiPath = path.replace(/:(\w+)/g, "{$1}");

    if (!spec.paths[openapiPath]) {
      spec.paths[openapiPath] = {};
    }

    const operation: Record<string, unknown> = {
      operationId: definition.operationId,
      summary: definition.summary,
      description: definition.description,
      tags: definition.tags,
      parameters: [],
      responses: {},
    };

    if (definition.request?.params) {
      await addSchemaParameters(
        definition.request.params,
        "path",
        operation.parameters as unknown[],
      );
    }

    if (definition.request?.query) {
      await addSchemaParameters(
        definition.request.query,
        "query",
        operation.parameters as unknown[],
      );
    }

    if (definition.request?.headers) {
      await addSchemaParameters(
        definition.request.headers,
        "header",
        operation.parameters as unknown[],
      );
    }

    if (definition.request?.cookies) {
      await addSchemaParameters(
        definition.request.cookies,
        "cookie",
        operation.parameters as unknown[],
      );
    }

    if (definition.request?.body) {
      const bodyResult = await toOpenAPISchema(definition.request.body);

      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: bodyResult.schema,
          },
        },
      };
    }

    for (const [status, schema] of Object.entries(definition.response)) {
      const responseResult = await toOpenAPISchema(schema);

      (operation.responses as Record<string, unknown>)[status] = {
        description:
          responseResult.schema.description ?? `Response for status ${status}`,
        content: {
          "application/json": {
            schema: responseResult.schema,
          },
        },
      };
    }

    spec.paths[openapiPath][definition.method.toLowerCase()] = operation;
  }

  return spec;
};
