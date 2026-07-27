export class InvalidRetryError extends TypeError {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRetryError";
  }
}

export class InvalidResultError extends TypeError {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidResultError";
  }
}
