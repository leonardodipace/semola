export type Action = "read" | "create" | "update" | "delete" | (string & {});
export type Entity = string;

export type Conditions<T = any> = Partial<T>;

export type Rule<T = any> = {
  action: Action;
  entity: Entity;
  conditions?: Conditions<T>;
  inverted: boolean;
  reason?: string;
};

export type AllowParams<T = any> = {
  action: Action;
  entity: Entity;
  conditions?: Conditions<T>;
  reason?: string;
};

export type ForbidParams<T = any> = {
  action: Action;
  entity: Entity;
  conditions?: Conditions<T>;
  reason?: string;
};

export type CanResult = {
  allowed: boolean;
  reason?: string;
};
