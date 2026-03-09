import type { Action, AllowParams, ForbidParams, Rule } from "./types.js";

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

  public can(action: Action, object?: TEntity) {
    const filteredRules = this.rules.filter((rule) => rule.action === action);

    const forbidResult = this.checkForbids(filteredRules, object);

    if (forbidResult) {
      return forbidResult;
    }

    const allowResult = this.checkAllows(filteredRules, object);

    if (allowResult) {
      return allowResult;
    }

    return { allowed: false, reason: undefined };
  }

  private checkForbids(rules: Rule<TEntity>[], object?: TEntity) {
    for (const rule of rules) {
      if (!rule.inverted) {
        continue;
      }

      if (!rule.conditions || Object.entries(rule.conditions).length === 0) {
        return { allowed: false, reason: rule.reason };
      }

      if (object && this.deepMatch(object, rule.conditions)) {
        return { allowed: false, reason: rule.reason };
      }
    }
  }

  private checkAllows(rules: Rule<TEntity>[], object?: TEntity) {
    for (const rule of rules) {
      if (rule.inverted) {
        continue;
      }

      if (!rule.conditions || Object.entries(rule.conditions).length === 0) {
        return { allowed: true, reason: rule.reason };
      }

      if (object && this.deepMatch(object, rule.conditions)) {
        return { allowed: true, reason: rule.reason };
      }
    }
  }

  private deepMatch(objectValue: unknown, conditionValue: object) {
    if (typeof objectValue !== "object" || objectValue === null) {
      return false;
    }

    for (const [key, nestedCondition] of Object.entries(conditionValue)) {
      const nestedValue = Reflect.get(objectValue, key);

      if (!this.matchValue(nestedValue, nestedCondition)) {
        return false;
      }
    }

    return true;
  }

  private matchValue(actual: unknown, condition: unknown) {
    if (typeof condition !== "object" || condition === null) {
      return false;
    }

    if ("fn" in condition && typeof condition.fn === "function") {
      return condition.fn(actual);
    }

    return this.deepMatch(actual, condition);
  }
}

export type { ConditionHelper } from "./helpers.js";
export {
  and,
  endsWith,
  eq,
  gt,
  gte,
  has,
  hasAny,
  hasLength,
  includes,
  isDefined,
  isEmpty,
  isNullish,
  lt,
  lte,
  matches,
  neq,
  not,
  or,
  startsWith,
} from "./helpers.js";
