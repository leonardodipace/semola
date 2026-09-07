import type { Column } from "../column/types.js";

export type Check = {
  sqlName: string;
  columns: Column[];
  expression: string;
};

export type CheckOnResult = Omit<Check, "expression"> & {
  where: (sql: string) => Check;
};

export type CheckInput = Check | CheckOnResult;

export type CheckSnapshot = {
  name: string;
  table: string;
  expression: string;
  columns: string[];
};

export type CheckBuilderState = {
  sqlName: string;
  expression?: string;
};

export type OnResult<State extends CheckBuilderState> =
  State["expression"] extends string ? Check : CheckOnResult;

export type CheckBuilder<State extends CheckBuilderState = CheckBuilderState> =
  {
    on: (...columns: Column[]) => OnResult<State>;
    where: (sql: string) => CheckBuilder<State & { expression: string }>;
  };
