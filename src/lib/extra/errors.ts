export class InvalidRetryError extends TypeError {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRetryError";
  }
}

export class InvalidResultError<TRetryResult> extends TypeError {
  public data: TRetryResult;

  public constructor(data: TRetryResult, message: string) {
    super(message);
    this.data = data;
    this.name = "InvalidResultError";
  }
}

export class InvalidThresholdValueError extends RangeError {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidThresholdValueError";
  }
}
