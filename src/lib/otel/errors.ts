export class OtelError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OtelError";
  }
}

export class ExportError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

export class InvalidOptionsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidOptionsError";
  }
}
