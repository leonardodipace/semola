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
import {
  assertNoForeignKeyConflicts,
  primaryKeyValueFromRow,
  resolveHasOneColumns,
  runHasManyWrites,
  splitMutationData,
} from "./mutation-relations.js";
import { DialectQueryBuilder } from "./query-builder.js";
import { RowParser } from "./row-parser.js";
import { enableSqliteForeignKeys } from "./sqlite.js";
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

    return this.executeQuery(sql, query);
  }

  public async findFirst<const TOptions extends FindFirstOptions<T, R>>(
    sql: Bun.SQL,
    options?: TOptions,
  ) {
    const query = this.builder.buildFindFirst(options);
    const [row] = await this.executeQuery(sql, query);

    return row ?? null;
  }

  public async findUnique<const TOptions extends FindUniqueOptions<T, R>>(
    sql: Bun.SQL,
    options: TOptions,
  ) {
    const query = this.builder.buildFindUnique(options);
    const [row] = await this.executeQuery(sql, query);

    return row ?? null;
  }

  public async create<const TOptions extends CreateOptions<T, R>>(
    sql: Bun.SQL,
    options: TOptions,
  ) {
    const split = splitMutationData(
      this.builder.table,
      this.builder.relations,
      options.data as Record<string, unknown>,
    );

    if (!split.relationWrites.length) {
      const query = this.builder.buildCreate(options);

      return this.executeOne(sql, query, "insert");
    }

    return this.relationTransaction(
      sql,
      split,
      async (txSql, mergedData) => {
        const row = await this.executeOne(
          txSql,
          this.builder.buildCreate({
            ...options,
            data: mergedData,
          } as TOptions),
          "insert",
        );

        return { row: row as Record<string, unknown> };
      },
      options,
    );
  }

  public async createMany(sql: Bun.SQL, options: CreateManyOptions<T>) {
    if (!options.data.length) {
      return [];
    }

    const query = this.builder.buildCreateMany(options);

    return this.executeQuery(sql, query);
  }

  public async update<const TOptions extends UpdateOptions<T, R>>(
    sql: Bun.SQL,
    options: TOptions,
  ) {
    const split = splitMutationData(
      this.builder.table,
      this.builder.relations,
      options.data as Record<string, unknown>,
    );

    if (!split.relationWrites.length) {
      const query = this.builder.buildUpdate(options);

      return this.executeOne(sql, query, "update");
    }

    return this.relationTransaction(
      sql,
      split,
      async (txSql, mergedData) => {
        if (Object.keys(mergedData).length > 0) {
          const row = await this.executeOne(
            txSql,
            this.builder.buildUpdate({
              ...options,
              data: mergedData,
            } as TOptions),
            "update",
          );

          return {
            row: row as Record<string, unknown>,
            where: options.where as Record<string, unknown>,
          };
        }

        const row = await this.findUnique(txSql, {
          where: options.where,
          select: options.select,
          include: options.include,
        } as FindUniqueOptions<T, R>);

        if (!row) {
          throw new Error(
            `Record not found after update on table ${this.builder.table.sqlName}`,
          );
        }

        return {
          row: row as Record<string, unknown>,
          where: options.where as Record<string, unknown>,
        };
      },
      options,
    );
  }

  public async updateMany(sql: Bun.SQL, options: UpdateManyOptions<T, R>) {
    const query = this.builder.buildUpdateMany(options);

    return this.executeQuery(sql, query);
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

    return this.executeQuery(sql, query);
  }

  private async relationTransaction(
    sql: Bun.SQL,
    split: ReturnType<typeof splitMutationData>,
    runParent: (
      txSql: Bun.SQL,
      mergedData: Record<string, unknown>,
    ) => Promise<{
      row: Record<string, unknown>;
      where?: Record<string, unknown>;
    }>,
    options: {
      include?: FindUniqueOptions<T, R>["include"];
      select?: FindUniqueOptions<T, R>["select"];
      where?: FindUniqueOptions<T, R>["where"];
    },
  ) {
    const run = async (txSql: Bun.SQL) => {
      assertNoForeignKeyConflicts(
        this.builder.relations,
        split.columnData,
        split.relationWrites,
      );

      const hasOneData = await resolveHasOneColumns({
        sql: txSql,
        spec: this.builder.spec,
        parentTable: this.builder.table,
        relations: this.builder.relations,
        relationWrites: split.relationWrites,
      });
      const mergedData = { ...split.columnData, ...hasOneData };
      const { row, where } = await runParent(txSql, mergedData);
      const parentKey = primaryKeyValueFromRow(this.builder.table, row, where);
      const ranHasMany = await runHasManyWrites({
        sql: txSql,
        spec: this.builder.spec,
        parentTable: this.builder.table,
        relations: this.builder.relations,
        relationWrites: split.relationWrites,
        parentKey,
      });

      if (!options.include) return row;
      if (!ranHasMany) return row;

      if (options.where) {
        return this.findUnique(txSql, {
          where: options.where,
          select: options.select,
          include: options.include,
        } as FindUniqueOptions<T, R>);
      }

      const pkColumn = Object.entries(this.builder.table.columns).find(
        ([, column]) => column._meta.isPrimaryKey,
      )?.[0];

      if (!pkColumn) return row;

      return this.findUnique(txSql, {
        where: { [pkColumn]: parentKey },
        select: options.select,
        include: options.include,
      } as FindUniqueOptions<T, R>);
    };

    if (this.name === "sqlite") {
      await enableSqliteForeignKeys(sql);
    }

    return sql.begin(run);
  }

  private async executeQuery(sql: Bun.SQL, query: ReturningQuery) {
    if (this.name === "sqlite") {
      await enableSqliteForeignKeys(sql);
    }

    return this.parser.executeQuery(sql, this.builder.table, query);
  }

  private async executeOne(
    sql: Bun.SQL,
    query: ReturningQuery,
    operation: string,
  ) {
    const [row] = await this.executeQuery(sql, query);

    if (!row) {
      throw new Error(
        `Record not found after ${operation} on table ${this.builder.table.sqlName}`,
      );
    }

    return row;
  }
}
