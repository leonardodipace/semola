import { err, ok } from "../errors/index.js";

export enum ComponentEnum {
  Any = "any",
  Range = "range",
  Step = "step",
  Number = "number",
}

enum FieldAmountEnum {
  Min = 5,
  Max = 6,
}

type TokenValueType = string | number;
type CronFieldType = "second" | "minute" | "hour" | "day" | "month" | "weekday";
type ComponentType = {
  content: string;
  field: CronFieldType;
};

export type CronScannerError =
  | "EmptyCronExpressionError"
  | "CronLengthError"
  | "CronExpressionError";

export class Token {
  private readonly type: ComponentEnum;
  private readonly component: string;
  private readonly value: TokenValueType;

  private readonly field: CronFieldType;

  public constructor(
    component: string,
    type: ComponentEnum,
    value: TokenValueType,
    field: CronFieldType,
  ) {
    this.component = component;
    this.type = type;
    this.value = value;
    this.field = field;
  }

  public getComponent() {
    return this.component;
  }

  public getTokenType() {
    return this.type;
  }

  public getTokenValue() {
    return this.value;
  }

  public getField() {
    return this.field;
  }

  public toString() {
    const header = `component="${this.component}", type=${this.type}`;
    const body = `field="${this.field}", value=${this.value}`;

    return `Token{${header}, ${body}}`;
  }

  public equals(other: Token) {
    if (!other) return false;

    const isComponentEqual = this.component === other.getComponent();
    const isTokenTypeEqual = this.type === other.getTokenType();
    const isTokenValueEqual = this.value === other.getTokenValue();
    const isFieldEqual = this.field === other.getField();

    return (
      isComponentEqual && isTokenTypeEqual && isTokenValueEqual && isFieldEqual
    );
  }
}

export class Scanner {
  private expression: string;
  private current: number;
  private start: number;
  private tokens: Token[];

  public constructor(expression: string) {
    this.expression = expression;
    this.current = 0;
    this.start = 0;
    this.tokens = [];
  }

  public scan() {
    if (this.expression.length === 0) {
      return err<CronScannerError>(
        "EmptyCronExpressionError",
        "Cron expression have zero length",
      );
    }

    const fields = this.expression.trim().split(/\s+/);
    const hasMinLen = fields.length === FieldAmountEnum.Min;
    const hasMaxLen = fields.length === FieldAmountEnum.Max;

    if (!hasMinLen && !hasMaxLen) {
      return err<CronScannerError>(
        "CronLengthError",
        `Invalid number of fields for '${this.expression}'. Expected 5 or 6 fields but got ${fields.length} field(s)`,
      );
    }

    const components = this.createComponent(fields);

    for (let idx = 0; idx < components.length; idx++) {
      const component = components[idx];
      if (!component) {
        return err<CronScannerError>(
          "CronExpressionError",
          `Invalid cron expression: ${this.expression}`,
        );
      }

      this.current = 0;
      this.start = 0;
      const [error, _] = this.scanComponent(component);
      if (error) return err<CronScannerError>(error.type, error.message);
    }

    return ok(this.tokens);
  }

  private scanComponent(component: ComponentType) {
    const { field, content } = component;
    while (this.current < content.length) {
      let currentCh = this.advance(content);

      switch (currentCh) {
        case "*": {
          if (this.match(content, "/")) {
            const [error, _] = this.handleStep(component);
            if (error) return err<CronScannerError>(error.type, error.message);
          } else if (!this.peek(content)) {
            this.addToken("*", ComponentEnum.Any, "*", field);
          } else {
            return err<CronScannerError>(
              "CronExpressionError",
              `Invalid any expression '${content}' for field '${field}'`,
            );
          }

          break;
        }
        case "-": {
          currentCh = this.advance(content);
          if (this.isDigit(currentCh)) {
            const [error, _] = this.handleRangeWithStep(component);
            if (error) return err<CronScannerError>(error.type, error.message);
          } else {
            return err<CronScannerError>(
              "CronExpressionError",
              `Invalid range expression '${content}' for field '${field}'`,
            );
          }
          break;
        }
        case ",": {
          const next = this.peek(content);
          if (!next || next === ",") {
            return err<CronScannerError>(
              "CronExpressionError",
              `Invalid list expression '${content}' for field '${field}'`,
            );
          }

          break;
        }
        default: {
          if (this.isDigit(currentCh)) {
            const [error, _] = this.handleNumber(component);
            if (error) return err<CronScannerError>(error.type, error.message);
          } else {
            return err<CronScannerError>(
              "CronExpressionError",
              `Invalid cron expression '${this.expression}' in field '${field}'`,
            );
          }

          break;
        }
      }

      this.start = this.current;
    }

    return ok(true);
  }

  private addToken(
    component: string,
    type: ComponentEnum,
    value: TokenValueType,
    field: CronFieldType,
  ) {
    const token = new Token(component, type, value, field);
    this.tokens.push(token);
  }

  private advance(content: string) {
    let currentCh = content.charAt(this.current);
    this.current += 1;

    return currentCh;
  }

  private match(content: string, expected: string) {
    if (this.current >= content.length) return false;
    if (content.charAt(this.current) !== expected) return false;

    this.current += 1;
    return true;
  }

  private peek(content: string) {
    if (this.current >= content.length) return undefined;

    return content.charAt(this.current);
  }

  private handleStep(component: ComponentType) {
    const { field, content } = component;
    let ch = this.peek(content);
    const slashIdx = this.current - 1;

    while (ch && this.isDigit(ch)) {
      this.advance(content);
      ch = this.peek(content);
    }

    if (ch && ch !== ",") {
      return err<CronScannerError>(
        "CronExpressionError",
        `Invalid step expression '${content}' for field '${field}'`,
      );
    }

    const tokenContent = content.substring(this.start, this.current);
    const value = tokenContent.slice(slashIdx + 1, this.current);

    if (value.length === 0) {
      return err<CronScannerError>(
        "CronExpressionError",
        `Invalid step expression '${content}' for field '${field}'`,
      );
    }

    this.addToken(tokenContent, ComponentEnum.Step, Number(value), field);
    return ok(true);
  }

  private handleRangeWithStep(component: ComponentType) {
    const { field, content } = component;
    let ch = this.peek(content);

    while (ch && this.isDigit(ch)) {
      this.advance(content);
      ch = this.peek(content);
    }

    if (!ch) {
      return err<CronScannerError>(
        "CronExpressionError",
        `Invalid range expression '${content}' for field '${field}'`,
      );
    }

    if (this.match(content, "/")) {
      const [error, _] = this.handleStep(component);
      if (error) return err<CronScannerError>(error.type, error.message);

      return ok(true);
    }

    return err<CronScannerError>(
      "CronExpressionError",
      `Invalid range expression '${content}' for field '${field}'`,
    );
  }

  private handleNumber(component: ComponentType) {
    const { field, content } = component;
    let ch = this.peek(content);
    this.start = this.current - 1;

    while (ch && this.isDigit(ch)) {
      this.advance(content);
      ch = this.peek(content);
    }

    if (!ch) {
      // Reached the end of the component
      const item = content.substring(this.start);
      this.addToken(item, ComponentEnum.Number, Number(item), field);
      return ok(true);
    }

    if (this.match(content, "-")) {
      const [error, _] = this.handleRange(component);
      if (error) return err<CronScannerError>(error.type, error.message);

      return ok(true);
    }

    if (this.match(content, "/")) {
      const [error, _] = this.handleStep(component);
      if (error) return err<CronScannerError>(error.type, error.message);

      return ok(true);
    }

    if (!this.isDigit(ch) && ch !== ",") {
      return err<CronScannerError>(
        "CronExpressionError",
        `Invalid number '${content}' for field '${field}'`,
      );
    }

    const item = content.substring(this.start, this.current);
    this.addToken(item, ComponentEnum.Number, Number(item), field);
    return ok(true);
  }

  private handleRange(component: ComponentType) {
    const { field, content } = component;
    let ch = this.peek(content);

    if (!ch) {
      return err<CronScannerError>(
        "CronExpressionError",
        `Invalid range expression '${content}' for field '${field}'`,
      );
    }

    while (ch && this.isDigit(ch)) {
      this.advance(content);
      ch = this.peek(content);
    }

    if (!ch) {
      // Reached the end of the component
      const tokenContent = content.substring(this.start);
      this.addToken(tokenContent, ComponentEnum.Range, tokenContent, field);

      return ok(true);
    }

    if (this.match(content, "/")) {
      const [error, _] = this.handleStep(component);
      if (error) return err<CronScannerError>(error.type, error.message);

      return ok(true);
    }

    if (ch && ch !== ",") {
      return err<CronScannerError>(
        "CronExpressionError",
        `Invalid range expression '${content}' for field '${field}'`,
      );
    }

    const tokenContent = content.substring(this.start, this.current);
    this.addToken(tokenContent, ComponentEnum.Range, tokenContent, field);
    return ok(true);
  }

  private isDigit(ch: string) {
    return ch >= "0" && ch <= "9";
  }

  private createComponent(fields: string[]) {
    const fieldNames = [
      "second",
      "minute",
      "hour",
      "day",
      "month",
      "weekday",
    ] as const;
    const components = [];
    let offset = 1;
    if (fields.length === FieldAmountEnum.Max) offset = 0;

    for (let idx = 0; idx < fields.length; idx++) {
      const fieldName = fieldNames[idx + offset];
      const content = fields[idx];
      if (!fieldName || !content) break;

      components.push({ content, field: fieldName });
    }

    return components;
  }
}
