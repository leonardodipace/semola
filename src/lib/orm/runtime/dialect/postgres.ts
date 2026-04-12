import type {
  ColDefs,
  CreateInput,
  CreateManyInput,
  DeleteManyInput,
  RelationDefs,
  UpdateManyInput,
} from "../../types.js";
import { BaseDialect } from "./base.js";
import { expectSingleRow } from "./utils.js";

export class PostgresDialect<
  T extends ColDefs,
  TRels extends RelationDefs,
> extends BaseDialect<T, TRels> {
  public async create(input: CreateInput<T>) {
    const rows = await this.executeOrThrow(
      this.insert({ data: input.data, returning: true }),
    );

    return expectSingleRow(
      this.normalizeResultRows(rows),
      "Insert returned no rows",
    );
  }

  public async createMany(input: CreateManyInput<T>) {
    if (input.data.length === 0) {
      return { count: 0, rows: [] };
    }

    const rows = input.data.map((item) =>
      this.mapSqlRow(item as Record<string, unknown>),
    );

    const createdRows = await this.executeOrThrow(
      this.insertMany(rows, { returning: true }),
    );

    const normalizedRows = this.normalizeResultRows(createdRows);

    return {
      count: normalizedRows.length,
      rows: normalizedRows,
    };
  }

  public async updateMany(input: UpdateManyInput<T>) {
    const rows = await this.executeOrThrow(
      this.update({
        where: input.where,
        data: input.data,
        returning: true,
      }),
    );

    const normalizedRows = this.normalizeResultRows(rows);

    return {
      count: normalizedRows.length,
      rows: normalizedRows,
    };
  }

  public async deleteMany(input: DeleteManyInput<T>) {
    const rows = await this.executeOrThrow(
      this.deleteByWhere({ where: input.where, returning: true }),
    );

    const normalizedRows = this.normalizeResultRows(rows);

    return {
      count: normalizedRows.length,
      rows: normalizedRows,
    };
  }
}
