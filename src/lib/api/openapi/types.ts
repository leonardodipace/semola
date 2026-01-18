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
  schema: unknown;
  description?: string;
};

export type OpenApiRequestBody = {
  required?: boolean;
  content: {
    [mediaType: string]: {
      schema: unknown;
    };
  };
};

export type OpenApiResponse = {
  description: string;
  content?: {
    [mediaType: string]: {
      schema: unknown;
    };
  };
};
