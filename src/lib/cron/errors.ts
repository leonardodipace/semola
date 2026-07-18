export class OutOfBoundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OutOfBoundError";
  }
}
