import type {
  CreateManyOptions,
  CreateOptions,
  DeleteManyOptions,
  DeleteOptions,
  FindFirstOptions,
  FindManyOptions,
  FindUniqueOptions,
  HasMany,
  HasOne,
  TableRelations,
  UpdateManyOptions,
  UpdateOptions,
} from "../orm/types.js";
import type { Table } from "../table/types.js";
import { foreignKeyResolver } from "./foreign-key.js";
import { DialectQueryBuilder } from "./query-builder.js";
import { RowParser } from "./row-parser.js";
import { columnKey, primaryKeyOf } from "./sql-helpers.js";
import { enableSqliteForeignKeys } from "./sqlite.js";
import type {
  CreateDialectInput,
  HasManyWriteInput,
  HasOneWriteInput,
  RelationWriteOptions,
  ReturningQuery,
  Row,
} from "./types.js";

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
    const rows = await this.executeQuery(sql, query);

    if (options?.take !== undefined) {
      if (options.take < 0) {
        rows.reverse();
      }
    }

    return rows;
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
    if (this.hasRelationWrites(options.data)) {
      return this.withRelationWrites(sql, options, (tx, data) => {
        const query = this.builder.buildCreate({ data } as CreateOptions<T, R>);

        return this.executeOne(tx, query, "insert");
      });
    }

    const query = this.builder.buildCreate(options);

    return this.executeOne(sql, query, "insert");
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
    if (this.hasRelationWrites(options.data)) {
      return this.withRelationWrites(sql, options, async (tx, data) => {
        if (!Object.keys(data).length) {
          return this.findExisting(tx, options.where);
        }

        const query = this.builder.buildUpdate({
          where: options.where,
          data,
        } as UpdateOptions<T, R>);

        return this.executeOne(tx, query, "update");
      });
    }

    const query = this.builder.buildUpdate(options);

    return this.executeOne(sql, query, "update");
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

  private hasRelationWrites(data: object) {
    return Object.keys(data).some((key) => key in this.builder.relations);
  }

  private async withRelationWrites(
    sql: Bun.SQL,
    options: RelationWriteOptions<T, R>,
    write: (tx: Bun.SQL, data: Row) => Promise<Row>,
  ) {
    const run = async (tx: Bun.SQL) => {
      const data: Row = {};
      const hasManyWrites: Array<[HasMany<Table>, HasManyWriteInput]> = [];

      for (const [key, value] of Object.entries(options.data as Row)) {
        const relation = this.builder.relations[key];

        if (!relation) {
          data[key] = value;
          continue;
        }

        if (value === undefined) continue;

        if (relation._type === "hasMany") {
          hasManyWrites.push([relation, value as HasManyWriteInput]);
          continue;
        }

        await this.applyHasOneWrite(
          tx,
          relation,
          value as HasOneWriteInput,
          data,
        );
      }

      const row = await write(tx, data);

      for (const [relation, input] of hasManyWrites) {
        await this.applyHasManyWrite(tx, relation, input, row);
      }

      const primaryKey = primaryKeyOf(this.builder.table);

      return this.findExisting(
        tx,
        { [primaryKey]: row[primaryKey] },
        { select: options.select, include: options.include },
      );
    };

    if ("savepoint" in sql) {
      return (sql as Bun.TransactionSQL).savepoint(run);
    }

    if (this.name === "sqlite") {
      await enableSqliteForeignKeys(sql);
    }

    return sql.begin(run);
  }

  private async applyHasOneWrite(
    tx: Bun.SQL,
    relation: HasOne<Table>,
    input: HasOneWriteInput,
    data: Row,
  ) {
    const link = foreignKeyResolver.resolveHasOne({
      sourceTable: this.builder.table,
      relationTable: relation._table,
      relationForeignKey: relation._foreignKey,
    });

    if (input.disconnect) {
      data[relation._foreignKey] = null;
    }

    if (input.connect) {
      const related = this.relatedDialect(relation._table);
      const target = await related.findExisting(tx, input.connect);

      data[relation._foreignKey] =
        target[columnKey(relation._table, link.target)];
    }
  }

  private async applyHasManyWrite(
    tx: Bun.SQL,
    relation: HasMany<Table>,
    input: HasManyWriteInput,
    row: Row,
  ) {
    const table = this.builder.table;
    const link = foreignKeyResolver.resolveHasMany(table, relation._table);
    const related = this.relatedDialect(relation._table);
    const foreignKey = columnKey(relation._table, link.fk);
    const parentValue = row[columnKey(table, link.source)];

    for (const where of input.connect ?? []) {
      await related.update(tx, {
        where,
        data: { [foreignKey]: parentValue },
      } as UpdateOptions<Table, TableRelations>);
    }

    for (const where of input.disconnect ?? []) {
      await related.update(tx, {
        where: { ...where, [foreignKey]: parentValue },
        data: { [foreignKey]: null },
      } as UpdateOptions<Table, TableRelations>);
    }
  }

  private relatedDialect(table: Table) {
    return new SqlDialect({ spec: this.builder.spec, table, relations: {} });
  }

  private async findExisting(
    sql: Bun.SQL,
    where: Row,
    options?: Omit<RelationWriteOptions<T, R>, "data">,
  ) {
    const row = await this.findUnique(sql, {
      ...options,
      where,
    } as FindUniqueOptions<T, R>);

    if (!row) {
      throw new Error(
        `Record not found on table ${this.builder.table.sqlName} for ${JSON.stringify(where)}`,
      );
    }

    return row;
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
