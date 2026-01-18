// OpenAPI v3.1 compatible types
// We define our own types because the standard openapi-types package
// has strict type checking that's incompatible with dynamic schema generation

export type OpenApiSpec = {
  openapi: string;
  info: {
    title: string;
    description?: string;
    version: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, OpenApiPath>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
};

export type OpenApiPath = {
  [method: string]: OpenApiOperation;
};

export type OpenApiOperation = {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
  security?: Array<Record<string, string[]>>;
};

export type OpenApiParameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema: unknown; // Flexible to accept any schema from converters
  description?: string;
};

export type OpenApiRequestBody = {
  required?: boolean;
  content: {
    [mediaType: string]: {
      schema: unknown; // Flexible to accept any schema from converters
    };
  };
};

export type OpenApiResponse = {
  description: string;
  content?: {
    [mediaType: string]: {
      schema: unknown; // Flexible to accept any schema from converters
    };
  };
};
