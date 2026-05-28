export class WorkflowError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

export class NotFoundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class StateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}

export class SerializationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SerializationError";
  }
}

export class ExecutionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExecutionError";
  }
}

export class LockError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LockError";
  }
}

export class CancelledError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CancelledError";
  }
}
