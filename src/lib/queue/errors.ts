export class SerializationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SerializationError";
  }
}

export class EnqueueError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EnqueueError";
  }
}
