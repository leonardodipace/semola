export class PromptIOError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PromptIOError";
  }
}

export class PromptEnvironmentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PromptEnvironmentError";
  }
}

export class PromptCancelledError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PromptCancelledError";
  }
}
