import type {
  Action,
  AllowParams,
  CanResult,
  Conditions,
  Entity,
  ForbidParams,
  Rule,
} from "./types.js";

export class Policy {
  private rules: Rule[] = [];

  public allow<T>(params: AllowParams<T>) {
    this.rules.push({
      action: params.action,
      entity: params.entity,
      conditions: params.conditions,
      inverted: false,
      reason: params.reason,
    });
  }

  public forbid<T>(params: ForbidParams<T>) {
    this.rules.push({
      action: params.action,
      entity: params.entity,
      conditions: params.conditions,
      inverted: true,
      reason: params.reason,
    });
  }

  public can<T>(action: Action, entity: Entity, object?: T): CanResult {
    const filteredRules = this.rules
      .filter((rule) => rule.action === action)
      .filter((rule) => rule.entity === entity);

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

  private matchesConditions<T>(object: T, conditions: Conditions<T>) {
    for (const key in conditions) {
      const matchesConditions = object[key] === conditions[key];

      if (!matchesConditions) {
        return false;
      }
    }

    return true;
  }
}
