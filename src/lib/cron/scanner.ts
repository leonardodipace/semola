enum ComponentType {
  Any = "any",
  List = "list",
  Range = "range",
  Step = "step",
  Number = "number",
}

enum ComponentAmount {
  Min = 5,
  Max = 6,
}

type TokenValueType = string | number | number[];

class Token {
  private readonly type: ComponentType;
  private readonly component: string;
  private readonly value: TokenValueType;

  constructor(component: string, type: ComponentType, value: TokenValueType) {
    this.component = component;
    this.type = type;
    this.value = value;
  }

  public toString() {
    return `Token{component="${this.component}", type=${this.type}, value=${this.value}}`;
  }
}

class ErrorReporter {
  public static report(msg: string, expression: string) {
    throw new Error(`${msg}: '${expression}'`);
  }
}

export class Scanner {
  private expression: string;
  private current: number = 0;
  private tokens: Token[] = [];

  constructor(expression: string) {
    this.expression = expression;
  }

  public scan() {
    if (this.expression.length === 0) return [];

    const components = this.expression.trim().split(/\s+/);
    const hasMinLen = components.length === ComponentAmount.Min;
    const hasMaxLen = components.length === ComponentAmount.Max;

    if (!hasMinLen && !hasMaxLen) return [];

    for (let idx = 0; idx < components.length; idx++) {
      const component = components[idx];
      if (!component) return [];
      this.current = 0;

      this.scanComponent(component);
    }

    return this.tokens;
  }

  private scanComponent(component: string) {
    while (this.current < component.length) {
      const currentCh = component.charAt(this.current);
      this.current += 1;

      switch (currentCh) {
        case "*": {
          if (this.match(component, "/")) {
            this.handleStep(component);
          } else {
            this.addToken(component, ComponentType.Any, "*");
          }

          break;
        }
        default: {
          if (this.isDigit(currentCh)) {
            this.handleNumber(component);
          } else {
            ErrorReporter.report("Invalid Cron Expression", this.expression);
          }

          break;
        }
      }
    }
  }

  private addToken(
    component: string,
    type: ComponentType,
    value: TokenValueType,
  ) {
    const token = new Token(component, type, value);
    this.tokens.push(token);
  }

  private match(component: string, expected: string) {
    if (this.current >= component.length) return false;
    if (component.charAt(this.current) !== expected) return false;

    this.current += 1;
    return true;
  }

  private peek(component: string) {
    if (this.current >= component.length) return undefined;

    return component.charAt(this.current);
  }

  private handleStep(component: string) {
    const start = this.current;
    while (this.peek(component) && this.current < component.length) {
      const ch = this.peek(component);
      if (ch && this.isDigit(ch)) this.current += 1;
    }

    const value = component.substring(start, this.current);
    this.addToken(component, ComponentType.Step, Number(value));
  }

  private handleNumber(component: string) {
    let ch = this.peek(component);

    while (ch && this.isDigit(ch)) {
      ch = this.peek(component);
      this.current += 1;
    }

    ch = this.peek(component);
    if (!ch) {
      this.addToken(component, ComponentType.Number, Number(component));
      return;
    }

    if (this.isDigit(ch)) {
      this.current += 1;
      this.addToken(component, ComponentType.Number, Number(component));
    }

    if (this.match(component, "-")) {
      this.handleRange(component);
    }
  }

  private handleRange(component: string) {
    let ch = this.peek(component);

    while (ch && this.isDigit(ch)) {
      ch = this.peek(component);
      this.current += 1;
    }

    ch = this.peek(component);
    if (ch) ErrorReporter.report("Invalid range expression", this.expression);

    const rangeValues = component.slice(0, this.current);
    this.addToken(component, ComponentType.Range, rangeValues);
  }

  private isDigit(ch: string) {
    return ch >= "0" && ch <= "9";
  }
}
