import type { ColumnKind, ColumnMetaBase, KindToType } from "./types.js";

export class ColumnDef<
  K extends ColumnKind,
  TMeta extends ColumnMetaBase,
  TValue = KindToType<K>,
> {
  public constructor(
    public readonly kind: K,
    public readonly meta: TMeta,
  ) {}

  public primaryKey() {
    return new ColumnDef<
      K,
      TMeta & { isPrimaryKey: true; isNotNull: true },
      TValue
    >(this.kind, {
      ...this.meta,
      isPrimaryKey: true as const,
      isNotNull: true as const,
    });
  }

  public notNull() {
    return new ColumnDef<K, TMeta & { isNotNull: true }, TValue>(this.kind, {
      ...this.meta,
      isNotNull: true as const,
    });
  }

  public unique() {
    return new ColumnDef<K, TMeta & { isUnique: true }, TValue>(this.kind, {
      ...this.meta,
      isUnique: true as const,
    });
  }

  public references(fn: () => ColumnDef<ColumnKind, ColumnMetaBase, unknown>) {
    return new ColumnDef<
      K,
      TMeta & {
        references: () => ColumnDef<ColumnKind, ColumnMetaBase, unknown>;
      },
      TValue
    >(this.kind, { ...this.meta, references: fn });
  }

  public onDelete(action: "CASCADE" | "RESTRICT" | "SET NULL") {
    return new ColumnDef<
      K,
      TMeta & { onDeleteAction: "CASCADE" | "RESTRICT" | "SET NULL" },
      TValue
    >(this.kind, { ...this.meta, onDeleteAction: action });
  }

  public default(value: TValue) {
    return new ColumnDef<
      K,
      TMeta & { hasDefault: true; defaultKind: "value" },
      TValue
    >(this.kind, {
      ...this.meta,
      hasDefault: true as const,
      defaultKind: "value" as const,
      defaultValue: value,
      defaultFn: () => value,
    });
  }

  public defaultFn(fn: () => TValue) {
    return new ColumnDef<
      K,
      TMeta & { hasDefault: true; defaultKind: "fn" },
      TValue
    >(this.kind, {
      ...this.meta,
      hasDefault: true as const,
      defaultKind: "fn" as const,
      defaultValue: undefined,
      defaultFn: fn,
    });
  }
}

// Using explicit Omit<ColumnMetaBase, "sqlName"> annotation so boolean fields are typed
// as `boolean` (not literal `false`). This is required for the chaining methods to work:
// { isPrimaryKey: boolean } & { isPrimaryKey: true } = { isPrimaryKey: true }
// vs { isPrimaryKey: false } & { isPrimaryKey: true } = { isPrimaryKey: never }
const defaultMeta: Omit<ColumnMetaBase, "sqlName"> = {
  isPrimaryKey: false,
  isNotNull: false,
  isUnique: false,
  hasDefault: false,
  defaultKind: null,
  defaultValue: undefined,
  defaultFn: null,
  references: null,
  onDeleteAction: null,
};

export function uuid(sqlName: string) {
  return new ColumnDef("uuid", { ...defaultMeta, sqlName });
}

export function string(sqlName: string) {
  return new ColumnDef("string", { ...defaultMeta, sqlName });
}

export function number(sqlName: string) {
  return new ColumnDef("number", { ...defaultMeta, sqlName });
}

export function boolean(sqlName: string) {
  return new ColumnDef("boolean", { ...defaultMeta, sqlName });
}

export function date(sqlName: string) {
  return new ColumnDef("date", { ...defaultMeta, sqlName });
}

export function json<const T>(sqlName: string) {
  return new ColumnDef<"json", ColumnMetaBase, T>("json", {
    ...defaultMeta,
    sqlName,
  });
}

export function jsonb<const T>(sqlName: string) {
  return new ColumnDef<"jsonb", ColumnMetaBase, T>("jsonb", {
    ...defaultMeta,
    sqlName,
  });
}
