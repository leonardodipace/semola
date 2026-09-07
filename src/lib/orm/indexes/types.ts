import type { Column } from "../column/types.js";

export type Index = {
  sqlName: string;
  columns: Column[];
  unique: boolean;
  where?: string;
};

export type IndexOnResult = Omit<Index, "where"> & {
  where: (sql: string) => Index;
};

export type IndexInput = Index | IndexOnResult;

export type IndexSnapshot = {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  where?: string;
};

export type IndexBuilderState = {
  sqlName: string;
  unique: boolean;
  where?: string;
};

export type OnResult<State extends IndexBuilderState> =
  State["where"] extends string ? Index : IndexOnResult;

export type IndexBuilder<State extends IndexBuilderState = IndexBuilderState> =
  {
    on: (...columns: Column[]) => OnResult<State>;
    unique: () => IndexBuilder<State & { unique: true }>;
    where: (sql: string) => IndexBuilder<State & { where: string }>;
  };
