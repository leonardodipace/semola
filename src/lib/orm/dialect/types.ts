import type {
  BulkResult,
  CreateManyOptions,
  CreateOptions,
  CreateResult,
  DeleteManyOptions,
  DeleteOptions,
  DeleteResult,
  FindFirstOptions,
  FindFirstResult,
  FindManyOptions,
  FindManyResult,
  FindUniqueOptions,
  FindUniqueResult,
  TableRelations,
  UpdateManyOptions,
  UpdateOptions,
  UpdateResult,
} from "../orm/types.js";
import type { Table } from "../table/types.js";

export type Adapter = Bun.SQL["options"]["adapter"];

export type Dialect<
  T extends Table = Table,
  TRelations extends TableRelations = TableRelations,
> = {
  name: Adapter;
  findMany<const TOptions extends FindManyOptions<T, TRelations>>(
    sql: Bun.SQL,
    options?: TOptions,
  ): Promise<Array<FindManyResult<T, TRelations, TOptions>>>;

  findFirst<const TOptions extends FindFirstOptions<T, TRelations>>(
    sql: Bun.SQL,
    options?: TOptions,
  ): Promise<FindFirstResult<T, TRelations, TOptions>>;

  findUnique<const TOptions extends FindUniqueOptions<T, TRelations>>(
    sql: Bun.SQL,
    options: TOptions,
  ): Promise<FindUniqueResult<T, TRelations, TOptions>>;

  create<const TOptions extends CreateOptions<T, TRelations>>(
    sql: Bun.SQL,
    options: TOptions,
  ): Promise<CreateResult<T, TRelations, TOptions>>;

  createMany(sql: Bun.SQL, options: CreateManyOptions<T>): Promise<BulkResult>;

  update<const TOptions extends UpdateOptions<T, TRelations>>(
    sql: Bun.SQL,
    options: TOptions,
  ): Promise<UpdateResult<T, TRelations, TOptions>>;

  updateMany(sql: Bun.SQL, options: UpdateManyOptions<T>): Promise<BulkResult>;

  delete<const TOptions extends DeleteOptions<T, TRelations>>(
    sql: Bun.SQL,
    options: TOptions,
  ): Promise<DeleteResult<T, TRelations, TOptions>>;

  deleteMany(sql: Bun.SQL, options: DeleteManyOptions<T>): Promise<BulkResult>;
};
