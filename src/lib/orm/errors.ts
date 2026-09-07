export class OrmError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OrmError";
  }
}

export class MigrationError extends OrmError {
  public constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}
