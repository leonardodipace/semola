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
      const matchesConditions = object[key] === conditions[key];

      if (!matchesConditions) {
        return false;
      }
    }

    return true;
  }
}
