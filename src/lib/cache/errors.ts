export class CacheError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CacheError";
  }
}

export class InvalidTTLError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidTTLError";
  }
}

export class NotFoundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class SerializationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SerializationError";
  }
}

export class DeserializationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DeserializationError";
  }
}
