export class InvalidRetryError extends TypeError {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRetryError";
  }
}
