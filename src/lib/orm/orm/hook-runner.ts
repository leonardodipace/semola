import type { Table } from "../table/types.js";
import type {
  GlobalOrmHooks,
  OrmHooksConfig,
  OrmQueryOptions,
  OrmReadHookContext,
  RelationsFor,
} from "./types.js";

export class HookRunner<TTable extends Table = Table> {
  public constructor(
    private tableName: string,
    private table: TTable,
  ) {}

  public shouldSkip(options?: OrmQueryOptions) {
    return options?.$skipHooks === true;
  }

  public stripSkipHooks<T extends OrmQueryOptions>(options: T) {
    const { $skipHooks, ...queryOptions } = options;

    return queryOptions;
  }

  public toHookOptions<T extends OrmQueryOptions>(options: T | undefined) {
    if (!options) return;

    return this.stripSkipHooks(options);
  }

  public async withReadHooks<TResult, TOptions>(input: {
    skipHooks: boolean;
    hookOptions: TOptions;
    beforeGlobal?: (ctx: OrmReadHookContext<TOptions>) => void | Promise<void>;
    beforeTable?: (ctx: OrmReadHookContext<TOptions>) => void | Promise<void>;
    afterGlobal?: (
      ctx: OrmReadHookContext<TOptions, TResult>,
    ) => void | Promise<void>;
    afterTable?: (
      ctx: OrmReadHookContext<TOptions, TResult>,
    ) => void | Promise<void>;
    query: () => Promise<TResult>;
  }) {
    const beforeCtx: OrmReadHookContext<TOptions> = {
      tableName: this.tableName,
      table: this.table,
      options: input.hookOptions,
    };

    if (!input.skipHooks) {
      await this.runReadHooks(input.beforeGlobal, input.beforeTable, beforeCtx);
    }

    const result = await input.query();

    if (!input.skipHooks) {
      await this.runReadHooks(input.afterGlobal, input.afterTable, {
        ...beforeCtx,
        result,
      });
    }

    return result;
  }

  public async runReadHooks<THookContext>(
    globalHook: ((ctx: THookContext) => void | Promise<void>) | undefined,
    tableHook: ((ctx: THookContext) => void | Promise<void>) | undefined,
    ctx: THookContext,
  ) {
    await this.runHook(globalHook, ctx);
    await this.runHook(tableHook, ctx);
  }

  public async runHook<THookContext>(
    hook: ((ctx: THookContext) => void | Promise<void>) | undefined,
    ctx: THookContext,
  ) {
    await hook?.(ctx);
  }
}

export const pickGlobalHooks = <
  T extends Record<string, Table>,
  R extends RelationsFor<T>,
>(
  hooksConfig: OrmHooksConfig<T, R>,
): GlobalOrmHooks => {
  const { tables, ...globalHooks } = hooksConfig;

  return globalHooks;
};
