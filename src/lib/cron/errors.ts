export class OutOfBoundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OutOfBoundError";
  }
}

export class InvalidRetryError extends TypeError {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRetryError";
  }
}
