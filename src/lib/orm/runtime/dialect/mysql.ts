import { getPrimaryKeyColumn } from "../../internal/table.js";
import type {
  ColDefs,
  CreateInput,
  CreateManyInput,
  DeleteManyInput,
  RelationDefs,
  UpdateManyInput,
} from "../../types.js";
import { BaseDialect } from "./base.js";
import { expectSingleRow, mergeRows, toWhereInput } from "./utils.js";

export class MysqlDialect<
  T extends ColDefs,
  TRels extends RelationDefs,
> extends BaseDialect<T, TRels> {
  public async create(input: CreateInput<T>) {
    const primaryKey = getPrimaryKeyColumn(this.table);

    const selectCreatedRow = async (whereData: Record<string, unknown>) => {
      const rows = await this.selectRows({
        where: toWhereInput<T>(whereData),
        limit: 1,
      });

      return expectSingleRow(rows, "Insert returned no rows");
    };

    const insertResult = await this.executeOrThrow(
      this.insert({ data: input.data }),
    );

    if (!primaryKey) {
      return selectCreatedRow(input.data);
    }

    const selectCreatedRowByPrimaryKey = async (value: unknown) => {
      const whereByPk: Record<string, unknown> = {};
      Reflect.set(whereByPk, primaryKey.jsKey, value);

      return selectCreatedRow(whereByPk);
    };

    const providedPkValue = Reflect.get(input.data, primaryKey.jsKey);

    if (providedPkValue !== null && providedPkValue !== undefined) {
      return selectCreatedRowByPrimaryKey(providedPkValue);
    }

    let insertedPkValue: unknown;

    if (typeof insertResult === "object" && insertResult !== null) {
      insertedPkValue = Reflect.get(insertResult, "lastInsertRowid");

      if (insertedPkValue === null || insertedPkValue === undefined) {
        insertedPkValue = Reflect.get(insertResult, "insertId");
      }
    }

    if (insertedPkValue === null || insertedPkValue === undefined) {
      throw new Error("Insert returned no primary key");
    }

    return selectCreatedRowByPrimaryKey(insertedPkValue);
  }

  public async createMany(input: CreateManyInput<T>) {
    if (input.data.length === 0) {
      return { count: 0, rows: [] };
    }

    const rows = input.data.map((item) =>
      this.mapSqlRow(item as Record<string, unknown>),
    );

    await this.executeOrThrow(this.insertMany(rows, { returning: false }));

    return {
      count: rows.length,
      rows: [],
    };
  }

  public async updateMany(input: UpdateManyInput<T>) {
    // MySQL lacks RETURNING; rows are fetched before mutation. For atomicity, wrap in $transaction().
    const beforeRows = await this.selectRows({ where: input.where });

    await this.executeOrThrow(
      this.update({ where: input.where, data: input.data }),
    );

    return {
      count: beforeRows.length,
      rows: mergeRows(
        beforeRows,
        input.data as Partial<Record<string, unknown>>,
      ),
    };
  }

  public async deleteMany(input: DeleteManyInput<T>) {
    // MySQL lacks RETURNING; rows are fetched before mutation. For atomicity, wrap in $transaction().
    const rows = await this.selectRows({ where: input.where });

    await this.executeOrThrow(this.deleteByWhere({ where: input.where }));

    return {
      count: rows.length,
      rows,
    };
  }
}
