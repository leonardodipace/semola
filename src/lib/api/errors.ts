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
