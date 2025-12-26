export type CommonError =
  | "NotFoundError"
  | "UnauthorizedError"
  | "InternalServerError"
  | "ValidationError"
  | (string & {});
