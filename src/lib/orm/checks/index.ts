import type { Column } from "../column/types.js";
import { OrmError } from "../errors.js";
import type {
  Check,
  CheckBuilder,
  CheckBuilderState,
  CheckOnResult,
  OnResult,
} from "./types.js";

const nonEmptyExpression = (sql: string, checkName: string) => {
  if (!sql.trim()) {
    throw new OrmError(`Check ${checkName} expression cannot be empty`);
  }

  return sql;
};

const createCheckBuilder = <State extends CheckBuilderState>(
  state: State,
): CheckBuilder<State> => {
  const on = (...columns: Column[]): OnResult<State> => {
    if (columns.length === 0) {
      throw new OrmError(`Check ${state.sqlName} requires at least one column`);
    }

    if (state.expression !== undefined) {
      return {
        sqlName: state.sqlName,
        columns: [...columns],
        expression: state.expression,
      } satisfies Check as OnResult<State>;
    }

    const pending: CheckOnResult = {
      sqlName: state.sqlName,
      columns: [...columns],
      where: (sql: string) => {
        return {
          sqlName: state.sqlName,
          columns: [...columns],
          expression: nonEmptyExpression(sql, state.sqlName),
        } satisfies Check;
      },
    };

    return pending as OnResult<State>;
  };

  const where = (sql: string) => {
    return createCheckBuilder({
      ...state,
      expression: nonEmptyExpression(sql, state.sqlName),
    });
  };

  return { on, where };
};

export const check = (sqlName: string) => {
  return createCheckBuilder({ sqlName });
};
