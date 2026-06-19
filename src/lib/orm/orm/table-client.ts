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

  public async create<const TOptions extends CreateOptions<T, TRelations>>(
    options: TOptions,
  ): Promise<CreateResult<T, TRelations, TOptions>> {
    const skipHooks = this.hooks.shouldSkip(options);
    const hookOptions = this.hooks.stripSkipHooks(options);
    let queryOptions = hookOptions;

    if (!skipHooks) {
      const createHookResult = await this.globalHooks?.beforeCreate?.({
        tableName: this.tableName,
        table: this.table,
        options: hookOptions,
      });

      queryOptions = { ...hookOptions, ...createHookResult };

      const tableCreateHookResult = await this.tableHooks?.beforeCreate?.({
        tableName: this.tableName,
        table: this.table,
        options: queryOptions,
      });

      queryOptions = { ...queryOptions, ...tableCreateHookResult };
    }

    const result = await this.dialect.create(this.sql, queryOptions);

    if (!skipHooks) {
      await this.hooks.runReadHooks(
        this.globalHooks?.afterCreate,
        this.tableHooks?.afterCreate,
        {
          tableName: this.tableName,
          table: this.table,
          options: queryOptions,
          result,
        },
      );
    }

    return result;
  }

  public async createMany(options: CreateManyOptions<T>) {
    const skipHooks = this.hooks.shouldSkip(options);
    const hookOptions = this.hooks.stripSkipHooks(options);
    let queryOptions = hookOptions;

    if (!skipHooks) {
      const createManyHookResult = await this.globalHooks?.beforeCreateMany?.({
        tableName: this.tableName,
        table: this.table,
        options: hookOptions,
      });

      queryOptions = { ...hookOptions, ...createManyHookResult };

      const tableCreateManyHookResult =
        await this.tableHooks?.beforeCreateMany?.({
          tableName: this.tableName,
          table: this.table,
          options: queryOptions,
        });

      queryOptions = { ...queryOptions, ...tableCreateManyHookResult };
    }

    const result = await this.dialect.createMany(this.sql, queryOptions);

    if (!skipHooks) {
      const hookCtx = {
        tableName: this.tableName,
        table: this.table,
        options: queryOptions,
        result,
      };

      await this.hooks.runHook(this.globalHooks?.afterCreateMany, hookCtx);
      await this.hooks.runHook(this.tableHooks?.afterCreateMany, hookCtx);
    }

    return result;
  }

  public async update<const TOptions extends UpdateOptions<T, TRelations>>(
    options: TOptions,
  ): Promise<UpdateResult<T, TRelations, TOptions>> {
    const skipHooks = this.hooks.shouldSkip(options);
    const hookOptions = this.hooks.stripSkipHooks(options);
    let queryOptions = hookOptions;

    if (!skipHooks) {
      const updateHookResult = await this.globalHooks?.beforeUpdate?.({
        tableName: this.tableName,
        table: this.table,
        options: hookOptions,
      });

      queryOptions = { ...hookOptions, ...updateHookResult };

      const tableUpdateHookResult = await this.tableHooks?.beforeUpdate?.({
        tableName: this.tableName,
        table: this.table,
        options: queryOptions,
      });

      queryOptions = { ...queryOptions, ...tableUpdateHookResult };
    }

    const result = await this.dialect.update(this.sql, queryOptions);

    if (!skipHooks) {
      await this.hooks.runReadHooks(
        this.globalHooks?.afterUpdate,
        this.tableHooks?.afterUpdate,
        {
          tableName: this.tableName,
          table: this.table,
          options: queryOptions,
          result,
        },
      );
    }

    return result;
  }

  public async updateMany(options: UpdateManyOptions<T, TRelations>) {
    const skipHooks = this.hooks.shouldSkip(options);
    const hookOptions = this.hooks.stripSkipHooks(options);
    let queryOptions = hookOptions;

    if (!skipHooks) {
      const updateManyHookResult = await this.globalHooks?.beforeUpdateMany?.({
        tableName: this.tableName,
        table: this.table,
        options: hookOptions,
      });

      queryOptions = { ...hookOptions, ...updateManyHookResult };

      const tableUpdateManyHookResult =
        await this.tableHooks?.beforeUpdateMany?.({
          tableName: this.tableName,
          table: this.table,
          options: queryOptions,
        });

      queryOptions = { ...queryOptions, ...tableUpdateManyHookResult };
    }

    const result = await this.dialect.updateMany(this.sql, queryOptions);

    if (!skipHooks) {
      const hookCtx = {
        tableName: this.tableName,
        table: this.table,
        options: queryOptions,
        result,
      };

      await this.hooks.runHook(this.globalHooks?.afterUpdateMany, hookCtx);
      await this.hooks.runHook(this.tableHooks?.afterUpdateMany, hookCtx);
    }

    return result;
  }

  public async delete<const TOptions extends DeleteOptions<T, TRelations>>(
    options: TOptions,
  ): Promise<DeleteResult<T, TRelations, TOptions>> {
    const skipHooks = this.hooks.shouldSkip(options);
    const hookOptions = this.hooks.stripSkipHooks(options);
    let queryOptions = hookOptions;

    if (!skipHooks) {
      const deleteHookResult = await this.globalHooks?.beforeDelete?.({
        tableName: this.tableName,
        table: this.table,
        options: hookOptions,
      });

      queryOptions = { ...hookOptions, ...deleteHookResult };

      const tableDeleteHookResult = await this.tableHooks?.beforeDelete?.({
        tableName: this.tableName,
        table: this.table,
        options: queryOptions,
      });

      queryOptions = { ...queryOptions, ...tableDeleteHookResult };
    }

    const result = await this.dialect.delete(this.sql, queryOptions);

    if (!skipHooks) {
      await this.hooks.runReadHooks(
        this.globalHooks?.afterDelete,
        this.tableHooks?.afterDelete,
        {
          tableName: this.tableName,
          table: this.table,
          options: queryOptions,
          result,
        },
      );
    }

    return result;
  }

  public async deleteMany(options: DeleteManyOptions<T, TRelations>) {
    const skipHooks = this.hooks.shouldSkip(options);
    const hookOptions = this.hooks.stripSkipHooks(options);
    let queryOptions = hookOptions;

    if (!skipHooks) {
      const deleteManyHookResult = await this.globalHooks?.beforeDeleteMany?.({
        tableName: this.tableName,
        table: this.table,
        options: hookOptions,
      });

      queryOptions = { ...hookOptions, ...deleteManyHookResult };

      const tableDeleteManyHookResult =
        await this.tableHooks?.beforeDeleteMany?.({
          tableName: this.tableName,
          table: this.table,
          options: queryOptions,
        });

      queryOptions = { ...queryOptions, ...tableDeleteManyHookResult };
    }

    const result = await this.dialect.deleteMany(this.sql, queryOptions);

    if (!skipHooks) {
      const hookCtx = {
        tableName: this.tableName,
        table: this.table,
        options: queryOptions,
        result,
      };

      await this.hooks.runHook(this.globalHooks?.afterDeleteMany, hookCtx);
      await this.hooks.runHook(this.tableHooks?.afterDeleteMany, hookCtx);
    }

    return result;
  }
}
