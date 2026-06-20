import type {
  CreateManyOptions,
  CreateOptions,
  DeleteManyOptions,
  DeleteOptions,
  FindFirstOptions,
  FindManyOptions,
  FindUniqueOptions,
  TableRelations,
  UpdateManyOptions,
  UpdateOptions,
} from "../orm/types.js";
import type { Table } from "../table/types.js";
import { DialectQueryBuilder } from "./query-builder.js";
import { RowParser } from "./row-parser.js";
import type { CreateDialectInput, ReturningQuery } from "./types.js";

export class SqlDialect<T extends Table, R extends TableRelations> {
  public readonly name;
  private builder: DialectQueryBuilder<T, R>;
  private parser = new RowParser();

  public constructor(input: CreateDialectInput<T, R>) {
    this.name = input.spec.name;
    this.builder = new DialectQueryBuilder(input);
  }

  public async findMany<const TOptions extends FindManyOptions<T, R>>(
    sql: Bun.SQL,
    options?: TOptions,
  ) {
    const query = this.builder.buildFindMany(options);

    return this.parser.executeQuery(sql, this.builder.table, query);
  }

  public async findFirst<const TOptions extends FindFirstOptions<T, R>>(
    sql: Bun.SQL,
    options?: TOptions,
  ) {
    const query = this.builder.buildFindFirst(options);
    const [row] = await this.parser.executeQuery(
      sql,
      this.builder.table,
      query,
    );

    return row ?? null;
  }

  public async findUnique<const TOptions extends FindUniqueOptions<T, R>>(
    sql: Bun.SQL,
    options: TOptions,
  ) {
    const query = this.builder.buildFindUnique(options);
    const [row] = await this.parser.executeQuery(
      sql,
      this.builder.table,
      query,
    );

    return row ?? null;
  }

  public async create<const TOptions extends CreateOptions<T, R>>(
    sql: Bun.SQL,
    options: TOptions,
  ) {
    const query = this.builder.buildCreate(options);

    return this.executeOne(sql, query, "insert");
  }

  public async createMany(sql: Bun.SQL, options: CreateManyOptions<T>) {
    if (!options.data.length) {
      return [];
    }

    const query = this.builder.buildCreateMany(options);

    return this.parser.executeQuery(sql, this.builder.table, query);
  }

  public async update<const TOptions extends UpdateOptions<T, R>>(
    sql: Bun.SQL,
    options: TOptions,
  ) {
    const query = this.builder.buildUpdate(options);

    return this.executeOne(sql, query, "update");
  }

  public async updateMany(sql: Bun.SQL, options: UpdateManyOptions<T, R>) {
    const query = this.builder.buildUpdateMany(options);

    return this.parser.executeQuery(sql, this.builder.table, query);
  }

  public async delete<const TOptions extends DeleteOptions<T, R>>(
    sql: Bun.SQL,
    options: TOptions,
  ) {
    const query = this.builder.buildDelete(options);

    return this.executeOne(sql, query, "delete");
  }

  public async deleteMany(sql: Bun.SQL, options: DeleteManyOptions<T, R>) {
    const query = this.builder.buildDeleteMany(options);

    return this.parser.executeQuery(sql, this.builder.table, query);
  }

  private async executeOne(
    sql: Bun.SQL,
    query: ReturningQuery,
    operation: string,
  ) {
    const [row] = await this.parser.executeQuery(
      sql,
      this.builder.table,
      query,
    );

    if (!row) {
      throw new Error(
        `Record not found after ${operation} on table ${this.builder.table.sqlName}`,
      );
    }

    return row;
  }
}
