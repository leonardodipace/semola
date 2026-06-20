export class CliValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CliValidationError";
  }
}

export class UnknownCommandError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UnknownCommandError";
  }
}

export class MissingArgumentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MissingArgumentError";
  }
}
