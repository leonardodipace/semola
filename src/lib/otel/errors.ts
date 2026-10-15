export class ExportError extends Error {
  public readonly retryable: boolean;

  public constructor(message: string, retryable = true) {
    super(message);
    this.name = "ExportError";
    this.retryable = retryable;
  }
}

export class InvalidOptionsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidOptionsError";
  }
}
