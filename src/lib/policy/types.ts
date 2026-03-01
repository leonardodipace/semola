export type Action = "read" | "create" | "update" | "delete" | (string & {});
export type Entity = string;

export type Conditions<T = Record<string, unknown>> = Partial<T>;

export type Rule<T = Record<string, unknown>> = {
  action: Action;
  entity: Entity;
  conditions?: Conditions<T>;
  inverted: boolean;
  reason?: string;
};

export type AllowParams<T = Record<string, unknown>> = {
  action: Action;
  entity: Entity;
  conditions?: Conditions<T>;
  reason?: string;
};

export type ForbidParams<T = Record<string, unknown>> = {
  action: Action;
  entity: Entity;
  conditions?: Conditions<T>;
  reason?: string;
};

export type CanResult = {
  allowed: boolean;
  reason?: string;
};
