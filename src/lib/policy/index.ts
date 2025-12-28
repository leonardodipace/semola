import type {
  Action,
  AllowParams,
  Conditions,
  Entity,
  ForbidParams,
  Rule,
} from "./types.js";

export class Policy {
  private rules: Rule[] = [];

  public allow<T = any>(params: AllowParams<T>) {
    this.rules.push({
      action: params.action,
      entity: params.entity,
      conditions: params.conditions,
      inverted: false,
    });
  }

  public forbid<T = any>(params: ForbidParams<T>) {
    this.rules.push({
      action: params.action,
      entity: params.entity,
      conditions: params.conditions,
      inverted: true,
    });
  }

  public can<T = any>(action: Action, entity: Entity, object?: T) {
    for (const rule of this.rules) {
      if (rule.action !== action || rule.entity !== entity) {
        continue;
      }

      if (!rule.conditions) {
        return !rule.inverted;
      }

      if (object && this.matchesConditions(object, rule.conditions)) {
        return !rule.inverted;
      }
    }

    return false;
  }

  private matchesConditions<T>(object: T, conditions: Conditions<T>) {
    for (const key in conditions) {
      if (object[key] !== conditions[key]) {
        return false;
      }
    }
    return true;
  }
}
