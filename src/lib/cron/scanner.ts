enum ComponentEnum {
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

class Token {
  private readonly type: ComponentEnum;
  private readonly component: string;
  private readonly value: TokenValueType;

  private readonly field: CronFieldType;

  constructor(
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

  public toString() {
    const header = `component="${this.component}", type=${this.type}`;
    const body = `field="${this.field}", value=${this.value}`;

    return `Token{${header}, ${body}}`;
  }
}

class ErrorReporter {
  public static report(msg: string, expression: string) {
    throw new Error(`${msg}: '${expression}'`);
  }
}

export class Scanner {
  private expression: string;
  private current: number;
  private start: number;
  private tokens: Token[];

  constructor(expression: string) {
    this.expression = expression;
    this.current = 0;
    this.start = 0;
    this.tokens = [];
  }

  public scan() {
    if (this.expression.length === 0) return [];

    const fields = this.expression.trim().split(/\s+/);
    const hasMinLen = fields.length === FieldAmountEnum.Min;
    const hasMaxLen = fields.length === FieldAmountEnum.Max;

    if (!hasMinLen && !hasMaxLen) return [];
    const components = this.createComponent(fields);

    for (let idx = 0; idx < components.length; idx++) {
      const component = components[idx];
      if (!component) return [];

      this.current = 0;
      this.scanComponent(component);
    }

    return this.tokens;
  }

  private scanComponent(component: ComponentType) {
    const { field, content } = component;
    while (this.current < content.length) {
      let currentCh = content.charAt(this.current);
      this.current += 1;

      switch (currentCh) {
        case "*": {
          if (this.match(content, "/")) {
            this.handleStep(component);
          } else {
            this.addToken("*", ComponentEnum.Any, "*", field);
          }

          break;
        }
        case "-": {
          this.current += 1;
          currentCh = content.charAt(this.current);
          if (this.isDigit(currentCh)) {
            this.handleRange(component);
          } else {
            ErrorReporter.report("Invalid range expression", this.expression);
          }
          break;
        }
        case ",":
          break;
        default: {
          if (this.isDigit(currentCh)) {
            this.handleNumber(component);
          } else {
            ErrorReporter.report("Invalid cron expression", this.expression);
          }

          break;
        }
      }
    }
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

    while (ch && this.isDigit(ch)) {
      this.current += 1;
      ch = this.peek(content);
    }

    const tokenContent = content.substring(this.start, this.current);
    const slashIdx = tokenContent.indexOf("/");
    const value = tokenContent.slice(slashIdx + 1);

    this.addToken(tokenContent, ComponentEnum.Step, Number(value), field);
  }

  private handleNumber(component: ComponentType) {
    const { field, content } = component;
    let ch = this.peek(content);
    this.start = this.current - 1;

    while (ch && this.isDigit(ch)) {
      this.current += 1;
      ch = this.peek(content);
    }

    if (!ch) {
      // Reached the end of the component
      const item = content.substring(this.start);
      this.addToken(item, ComponentEnum.Number, Number(item), field);
      return;
    }

    if (this.match(content, "-")) {
      this.handleRange(component);
      return;
    }

    if (this.match(content, "/")) {
      this.handleStep(component);
      return;
    }

    const item = content.substring(this.start, this.current);
    this.addToken(item, ComponentEnum.Number, Number(item), field);
  }

  private handleRange(component: ComponentType) {
    const { field, content } = component;
    let ch = this.peek(content);

    while (ch && this.isDigit(ch)) {
      this.current += 1;
      ch = this.peek(content);
    }

    if (this.match(content, "/")) {
      this.handleStep(component);
      return;
    }

    if (ch && ch !== ",") {
      ErrorReporter.report("Invalid range expression", this.expression);
    }

    const tokenContent = content.substring(this.start, this.current);
    this.addToken(tokenContent, ComponentEnum.Range, tokenContent, field);
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
