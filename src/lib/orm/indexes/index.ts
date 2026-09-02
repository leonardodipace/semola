import type { Column } from "../column/types.js";
import { OrmError } from "../errors.js";
import type {
  Index,
  IndexBuilder,
  IndexBuilderState,
  IndexOnResult,
  OnResult,
} from "./types.js";

const nonEmptyWhere = (sql: string, indexName: string) => {
  if (typeof sql !== "string") {
    throw new OrmError(`Index ${indexName} where clause must be a string`);
  }

  if (!sql.trim()) {
    throw new OrmError(`Index ${indexName} where clause cannot be empty`);
  }

  return sql;
};

const buildIndex = (state: IndexBuilderState, columns: Column[]) => {
  if (columns.length === 0) {
    throw new OrmError(`Index ${state.sqlName} requires at least one column`);
  }

  const built: Index = {
    sqlName: state.sqlName,
    columns: [...columns],
    unique: state.unique,
  };

  if (state.where !== undefined) {
    built.where = state.where;
  }

  return built;
};

const createIndexBuilder = <State extends IndexBuilderState>(
  state: State,
): IndexBuilder<State> => {
  const on = (...columns: Column[]): OnResult<State> => {
    const built = buildIndex(state, columns);

    if (state.where !== undefined) {
      return built as OnResult<State>;
    }

    const pending: IndexOnResult = {
      sqlName: built.sqlName,
      columns: built.columns,
      unique: built.unique,
      where: (sql: string) => {
        return {
          ...built,
          where: nonEmptyWhere(sql, state.sqlName),
        };
      },
    };

    return pending as OnResult<State>;
  };

  const unique = () => {
    return createIndexBuilder({ ...state, unique: true });
  };

  const where = (sql: string) => {
    return createIndexBuilder({
      ...state,
      where: nonEmptyWhere(sql, state.sqlName),
    });
  };

  return { on, unique, where };
};

export const index = (sqlName: string) => {
  return createIndexBuilder({ sqlName, unique: false });
};

export const uniqueIndex = (sqlName: string) => {
  return createIndexBuilder({ sqlName, unique: true });
};
