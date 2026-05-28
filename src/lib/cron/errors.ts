export class InvalidValueError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidValueError";
  }
}

export class OutOfBoundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OutOfBoundError";
  }
}

export class CronExpressionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CronExpressionError";
  }
}

export class EmptyCronExpressionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EmptyCronExpressionError";
  }
}

export class CronLengthError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CronLengthError";
  }
}
