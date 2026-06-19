import { getDialect } from "../dialect/index.js";
import type { Dialect } from "../dialect/types.js";
import type { Table } from "../table/types.js";
import { HookRunner } from "./hook-runner.js";
import type {
  CreateManyOptions,
  CreateOptions,
  CreateResult,
  CreateTableClientInput,
  DeleteManyOptions,
  DeleteOptions,
  DeleteResult,
  FindFirstOptions,
  FindManyOptions,
  FindUniqueOptions,
  GlobalOrmHooks,
  OrmHookContext,
  TableHooks,
  TableRelations,
  UpdateManyOptions,
  UpdateOptions,
  UpdateResult,
} from "./types.js";

export class TableClientImpl<
  T extends Table,
  TRelations extends TableRelations,
> {
  private sql: Bun.SQL;
  private dialect: Dialect<T, TRelations>;
  private hooks: HookRunner<T>;
  private tableName: string;
  private table: T;
  private globalHooks?: GlobalOrmHooks;
  private tableHooks?: TableHooks<T, TRelations>;

  public constructor(input: CreateTableClientInput<T, TRelations>) {
    this.sql = input.sql;
    this.tableName = input.tableName;
    this.table = input.table;
    this.globalHooks = input.globalHooks;
    this.tableHooks = input.tableHooks;
    this.dialect = getDialect(input);
    this.hooks = new HookRunner(input.tableName, input.table);
  }

  public findMany<const TOptions extends FindManyOptions<T, TRelations>>(
    options?: TOptions,
  ) {
    const skipHooks = this.hooks.shouldSkip(options);
    const hookOptions = this.hooks.toHookOptions(options);

    return this.hooks.withReadHooks({
      skipHooks,
      hookOptions,
      beforeGlobal: this.globalHooks?.beforeFindMany,
      beforeTable: this.tableHooks?.beforeFindMany,
      afterGlobal: this.globalHooks?.afterFindMany,
      afterTable: this.tableHooks?.afterFindMany,
      query: () => this.dialect.findMany(this.sql, hookOptions),
    });
  }

  public findFirst<const TOptions extends FindFirstOptions<T, TRelations>>(
    options?: TOptions,
  ) {
    const skipHooks = this.hooks.shouldSkip(options);
    const hookOptions = this.hooks.toHookOptions(options);

    return this.hooks.withReadHooks({
      skipHooks,
      hookOptions,
      beforeGlobal: this.globalHooks?.beforeFindFirst,
      beforeTable: this.tableHooks?.beforeFindFirst,
      afterGlobal: this.globalHooks?.afterFindFirst,
      afterTable: this.tableHooks?.afterFindFirst,
      query: () => this.dialect.findFirst(this.sql, hookOptions),
    });
  }

  public findUnique<const TOptions extends FindUniqueOptions<T, TRelations>>(
    options: TOptions,
  ) {
    const skipHooks = this.hooks.shouldSkip(options);
    const hookOptions = this.hooks.stripSkipHooks(options);

    return this.hooks.withReadHooks({
      skipHooks,
      hookOptions,
      beforeGlobal: this.globalHooks?.beforeFindUnique,
      beforeTable: this.tableHooks?.beforeFindUnique,
      afterGlobal: this.globalHooks?.afterFindUnique,
      afterTable: this.tableHooks?.afterFindUnique,
      query: () => this.dialect.findUnique(this.sql, hookOptions),
    });
  }

  public create<const TOptions extends CreateOptions<T, TRelations>>(
    options: TOptions,
  ): Promise<CreateResult<T, TRelations, TOptions>> {
    const skipHooks = this.hooks.shouldSkip(options);
    const hookOptions = this.hooks.stripSkipHooks(options);

    return this.withMutationHooks({
      skipHooks,
      hookOptions,
      beforeGlobal: this.globalHooks?.beforeCreate,
      beforeTable: this.tableHooks?.beforeCreate,
      afterGlobal: this.globalHooks?.afterCreate,
      afterTable: this.tableHooks?.afterCreate,
      query: (queryOptions) => this.dialect.create(this.sql, queryOptions),
    });
  }

  public createMany(options: CreateManyOptions<T>) {
    const skipHooks = this.hooks.shouldSkip(options);
    const hookOptions = this.hooks.stripSkipHooks(options);

    return this.withMutationHooks({
      skipHooks,
      hookOptions,
      beforeGlobal: this.globalHooks?.beforeCreateMany,
      beforeTable: this.tableHooks?.beforeCreateMany,
      afterGlobal: this.globalHooks?.afterCreateMany,
      afterTable: this.tableHooks?.afterCreateMany,
      query: (queryOptions) => this.dialect.createMany(this.sql, queryOptions),
    });
  }

  public update<const TOptions extends UpdateOptions<T, TRelations>>(
    options: TOptions,
  ): Promise<UpdateResult<T, TRelations, TOptions>> {
    const skipHooks = this.hooks.shouldSkip(options);
    const hookOptions = this.hooks.stripSkipHooks(options);

    return this.withMutationHooks({
      skipHooks,
      hookOptions,
      beforeGlobal: this.globalHooks?.beforeUpdate,
      beforeTable: this.tableHooks?.beforeUpdate,
      afterGlobal: this.globalHooks?.afterUpdate,
      afterTable: this.tableHooks?.afterUpdate,
      query: (queryOptions) => this.dialect.update(this.sql, queryOptions),
    });
  }

  public updateMany(options: UpdateManyOptions<T, TRelations>) {
    const skipHooks = this.hooks.shouldSkip(options);
    const hookOptions = this.hooks.stripSkipHooks(options);

    return this.withMutationHooks({
      skipHooks,
      hookOptions,
      beforeGlobal: this.globalHooks?.beforeUpdateMany,
      beforeTable: this.tableHooks?.beforeUpdateMany,
      afterGlobal: this.globalHooks?.afterUpdateMany,
      afterTable: this.tableHooks?.afterUpdateMany,
      query: (queryOptions) => this.dialect.updateMany(this.sql, queryOptions),
    });
  }

  public delete<const TOptions extends DeleteOptions<T, TRelations>>(
    options: TOptions,
  ): Promise<DeleteResult<T, TRelations, TOptions>> {
    const skipHooks = this.hooks.shouldSkip(options);
    const hookOptions = this.hooks.stripSkipHooks(options);

    return this.withMutationHooks({
      skipHooks,
      hookOptions,
      beforeGlobal: this.globalHooks?.beforeDelete,
      beforeTable: this.tableHooks?.beforeDelete,
      afterGlobal: this.globalHooks?.afterDelete,
      afterTable: this.tableHooks?.afterDelete,
      query: (queryOptions) => this.dialect.delete(this.sql, queryOptions),
    });
  }

  public deleteMany(options: DeleteManyOptions<T, TRelations>) {
    const skipHooks = this.hooks.shouldSkip(options);
    const hookOptions = this.hooks.stripSkipHooks(options);

    return this.withMutationHooks({
      skipHooks,
      hookOptions,
      beforeGlobal: this.globalHooks?.beforeDeleteMany,
      beforeTable: this.tableHooks?.beforeDeleteMany,
      afterGlobal: this.globalHooks?.afterDeleteMany,
      afterTable: this.tableHooks?.afterDeleteMany,
      query: (queryOptions) => this.dialect.deleteMany(this.sql, queryOptions),
    });
  }

  private async withMutationHooks<TOptions, TResult>(input: {
    skipHooks: boolean;
    hookOptions: TOptions;
    beforeGlobal?: (
      ctx: OrmHookContext<TOptions>,
    ) => unknown | Promise<unknown>;
    beforeTable?: (ctx: OrmHookContext<TOptions>) => unknown | Promise<unknown>;
    afterGlobal?: (
      ctx: OrmHookContext<TOptions, TResult>,
    ) => void | Promise<void>;
    afterTable?: (
      ctx: OrmHookContext<TOptions, TResult>,
    ) => void | Promise<void>;
    query: (queryOptions: TOptions) => Promise<TResult>;
  }) {
    let queryOptions = input.hookOptions;

    if (!input.skipHooks) {
      const baseCtx: OrmHookContext<TOptions> = {
        tableName: this.tableName,
        table: this.table,
        options: input.hookOptions,
      };

      const globalResult = await input.beforeGlobal?.(baseCtx);
      queryOptions = mergeHookResult(input.hookOptions, globalResult);

      const tableResult = await input.beforeTable?.({
        ...baseCtx,
        options: queryOptions,
      });

      queryOptions = mergeHookResult(queryOptions, tableResult);
    }

    const result = await input.query(queryOptions);

    if (!input.skipHooks) {
      await this.hooks.runReadHooks(input.afterGlobal, input.afterTable, {
        tableName: this.tableName,
        table: this.table,
        options: queryOptions,
        result,
      });
    }

    return result;
  }
}

const mergeHookResult = <TOptions>(options: TOptions, result: unknown) => {
  if (typeof result !== "object") {
    return options;
  }

  if (result === null) {
    return options;
  }

  return { ...options, ...result };
};
