export class CliError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export class CliValidationError extends CliError {
  public constructor(message: string) {
    super(message);
    this.name = "CliValidationError";
  }
}

export class UnknownCommandError extends CliError {
  public constructor(message: string) {
    super(message);
    this.name = "UnknownCommandError";
  }
}

export class MissingArgumentError extends CliError {
  public constructor(message: string) {
    super(message);
    this.name = "MissingArgumentError";
  }
}
