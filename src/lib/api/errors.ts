export class ParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export class ValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class SchemaConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SchemaConfigError";
  }
}

export class DuplicateRouteError extends Error {
  public constructor(method: string, path: string) {
    super(`Duplicate route: ${method} ${path}`);
    this.name = "DuplicateRouteError";
  }
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  public constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.body = body;
  }
}
