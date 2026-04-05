export type CommonError =
  | "NotFoundError"
  | "UnauthorizedError"
  | "InternalServerError"
  | "ValidationError"
  | "MigrationError"
  | "SchemaError"
  | (string & {});
