export class UnsubscribeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UnsubscribeError";
  }
}

export class SerializationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SerializationError";
  }
}

export class PublishError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PublishError";
  }
}

export class SubscribeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SubscribeError";
  }
}
