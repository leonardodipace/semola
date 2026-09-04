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
import {
  applyRelationMutations,
  splitMutationData,
} from "./relation-mutations.js";
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
      return this.executeOne(sql, this.builder.buildCreate(options), "insert");
    }

    for (const write of split.relationWrites) {
      if (write.disconnect !== undefined) {
        throw new Error("disconnect is not valid during create");
      }
    }

    return this.withRelations(sql, split, options, async (txSql, data) => ({
      row: await this.executeOne(
        txSql,
        this.builder.buildCreate({ ...options, data } as TOptions),
        "insert",
      ),
    }));
  }

  public async createMany(sql: Bun.SQL, options: CreateManyOptions<T>) {
    if (!options.data.length) {
      return [];
    }

    return this.executeQuery(sql, this.builder.buildCreateMany(options));
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
      return this.executeOne(sql, this.builder.buildUpdate(options), "update");
    }

    return this.withRelations(sql, split, options, async (txSql, data) => {
      if (Object.keys(data).length > 0) {
        const row = await this.executeOne(
          txSql,
          this.builder.buildUpdate({ ...options, data } as TOptions),
          "update",
        );

        return { row, where: options.where as Record<string, unknown> };
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

      return { row, where: options.where as Record<string, unknown> };
    });
  }

  public async updateMany(sql: Bun.SQL, options: UpdateManyOptions<T, R>) {
    return this.executeQuery(sql, this.builder.buildUpdateMany(options));
  }

  public async delete<const TOptions extends DeleteOptions<T, R>>(
    sql: Bun.SQL,
    options: TOptions,
  ) {
    return this.executeOne(sql, this.builder.buildDelete(options), "delete");
  }

  public async deleteMany(sql: Bun.SQL, options: DeleteManyOptions<T, R>) {
    return this.executeQuery(sql, this.builder.buildDeleteMany(options));
  }

  private async withRelations(
    sql: Bun.SQL,
    split: ReturnType<typeof splitMutationData>,
    options: {
      include?: FindUniqueOptions<T, R>["include"];
      select?: FindUniqueOptions<T, R>["select"];
      where?: FindUniqueOptions<T, R>["where"];
    },
    parent: (
      txSql: Bun.SQL,
      data: Record<string, unknown>,
    ) => Promise<{
      row: Record<string, unknown>;
      where?: Record<string, unknown>;
    }>,
  ) {
    const run = async (txSql: Bun.SQL) => {
      for (const write of split.relationWrites) {
        const relation = this.builder.relations[write.relationName];

        if (!relation) continue;
        if (relation._type !== "hasOne") continue;
        if (!write.connect && !write.disconnect) continue;
        if (!(relation._foreignKey in split.columnData)) continue;

        throw new Error(
          `Cannot set ${relation._foreignKey} and nested ${write.relationName} write in the same mutation`,
        );
      }

      const base = {
        sql: txSql,
        spec: this.builder.spec,
        parent: this.builder.table,
        relations: this.builder.relations,
        writes: split.relationWrites,
        read: (table: Table, where: Record<string, unknown>, name: string) =>
          this.readConnectRow(txSql, table, where, name),
      };
      const { patches } = await applyRelationMutations({
        ...base,
        parentWhere: options.where as Record<string, unknown> | undefined,
      });
      const { row, where } = await parent(txSql, {
        ...split.columnData,
        ...patches,
      });

      let ranMany = false;
      let parentKey: unknown;

      if (this.needsHasManyWrites(split.relationWrites)) {
        parentKey = await this.relationParentKey(
          txSql,
          row,
          (options.where ?? where) as Record<string, unknown> | undefined,
        );
        const result = await applyRelationMutations({ ...base, parentKey });

        ranMany = result.ranMany;
      }

      if (!options.include) return row;
      if (!ranMany) return row;

      if (options.where) {
        return this.findUnique(txSql, {
          where: options.where,
          select: options.select,
          include: options.include,
        } as FindUniqueOptions<T, R>);
      }

      const pkKey = Object.entries(this.builder.table.columns).find(
        ([, column]) => column._meta.isPrimaryKey,
      )?.[0];

      if (!pkKey) return row;
      if (parentKey === undefined) return row;

      return this.findUnique(txSql, {
        where: { [pkKey]: parentKey },
        select: options.select,
        include: options.include,
      } as FindUniqueOptions<T, R>);
    };

    if (this.name === "sqlite") {
      await enableSqliteForeignKeys(sql);
    }

    return sql.begin(run);
  }

  private needsHasManyWrites(
    writes: ReturnType<typeof splitMutationData>["relationWrites"],
  ) {
    for (const write of writes) {
      const relation = this.builder.relations[write.relationName];

      if (!relation) continue;
      if (relation._type !== "hasMany") continue;
      if (!write.connect && !write.disconnect) continue;

      return true;
    }

    return false;
  }

  private async relationParentKey(
    txSql: Bun.SQL,
    row: Record<string, unknown>,
    where?: Record<string, unknown>,
  ) {
    const pkKey = Object.entries(this.builder.table.columns).find(
      ([, column]) => column._meta.isPrimaryKey,
    )?.[0];

    if (!pkKey) {
      throw new Error(
        `Table ${this.builder.table.sqlName} is missing a primary key column`,
      );
    }

    if (row[pkKey] !== undefined) return row[pkKey];

    if (where?.[pkKey] !== undefined) return where[pkKey];

    if (!where) {
      throw new Error(
        `Missing primary key value for table ${this.builder.table.sqlName} during relation write`,
      );
    }

    const loaded = await this.readConnectRow(
      txSql,
      this.builder.table,
      where,
      "parent",
    );

    return loaded[pkKey];
  }

  private async readConnectRow(
    txSql: Bun.SQL,
    table: Table,
    where: Record<string, unknown>,
    relationName: string,
  ) {
    const keys = Object.keys(where).filter((key) => where[key] !== undefined);

    if (keys.length !== 1) {
      throw new Error(
        `connect for ${relationName} must include exactly one unique where field`,
      );
    }

    const builder = new DialectQueryBuilder({
      spec: this.builder.spec,
      table,
      relations: {} as R,
      tableRelationsMap: this.builder.tableRelationsMap,
    });
    const query = builder.buildFindUnique({ where } as FindUniqueOptions<
      Table,
      R
    >);
    const [row] = await this.parser.executeQuery(txSql, table, query);

    if (!row) {
      throw new Error(
        `Record to connect not found on table ${table.sqlName} for ${JSON.stringify(where)}`,
      );
    }

    return row as Record<string, unknown>;
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
