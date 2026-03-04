import type {
  Action,
  AllowParams,
  CanResult,
  Conditions,
  ForbidParams,
  Rule,
} from "./types.js";

export class Policy<
  TEntity extends Record<string, unknown> = Record<string, unknown>,
> {
  private rules: Rule<TEntity>[] = [];

  public allow(params: AllowParams<TEntity>) {
    const actions = this.toActions(params.action);

    for (const action of actions) {
      this.rules.push({
        action,
        conditions: params.conditions,
        inverted: false,
        reason: params.reason,
      });
    }
  }

  public forbid(params: ForbidParams<TEntity>) {
    const actions = this.toActions(params.action);

    for (const action of actions) {
      this.rules.push({
        action,
        conditions: params.conditions,
        inverted: true,
        reason: params.reason,
      });
    }
  }

  private toActions(action: Action | Action[]) {
    if (Array.isArray(action)) {
      return action;
    }

    return [action];
  }

  public can(action: Action, object?: TEntity): CanResult {
    const filteredRules = this.rules.filter((rule) => rule.action === action);

    for (const rule of filteredRules) {
      if (!rule.conditions) {
        return {
          allowed: !rule.inverted,
          reason: rule.reason,
        };
      }

      if (object && this.matchesConditions(object, rule.conditions)) {
        return {
          allowed: !rule.inverted,
          reason: rule.reason,
        };
      }
    }

    return { allowed: false };
  }

  private matchesConditions(object: TEntity, conditions: Conditions<TEntity>) {
    for (const key in conditions) {
      const conditionValue = conditions[key];
      const objectValue = object[key];

      if (typeof conditionValue === "function") {
        if (!conditionValue(objectValue)) {
          return false;
        }
      } else if (
        conditionValue !== null &&
        typeof conditionValue === "object"
      ) {
        if (!this.deepMatch(objectValue, conditionValue)) {
          return false;
        }
      } else if (objectValue !== conditionValue) {
        return false;
      }
    }

    return true;
  }

  private deepMatch(objectValue: unknown, conditionValue: object): boolean {
    if (typeof objectValue !== "object" || objectValue === null) {
      return false;
    }

    for (const [key, nestedCondition] of Object.entries(conditionValue)) {
      const nestedValue = Reflect.get(objectValue, key);

      if (typeof nestedCondition === "function") {
        if (!nestedCondition(nestedValue)) {
          return false;
        }
      } else if (
        nestedCondition !== null &&
        typeof nestedCondition === "object"
      ) {
        if (!this.deepMatch(nestedValue, nestedCondition)) {
          return false;
        }
      } else if (nestedValue !== nestedCondition) {
        return false;
      }
    }

    return true;
  }
}
