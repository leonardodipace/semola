export class SerializationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SerializationError";
  }
}

export class NotFoundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class DuplicateWorkflowError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DuplicateWorkflowError";
  }
}

export class WorkflowStoreError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WorkflowStoreError";
  }
}

export class NonRetryableStepError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NonRetryableStepError";
  }
}

export class Paused extends Error {
  public constructor() {
    super("workflow paused");
    this.name = "Paused";
  }
}
