export class CliError extends Error {
  public override name = "CliError";
}

export class CliValidationError extends CliError {
  public override name = "CliValidationError";
}

export class UnknownCommandError extends CliError {
  public override name = "UnknownCommandError";
}

export class MissingArgumentError extends CliError {
  public override name = "MissingArgumentError";
}
