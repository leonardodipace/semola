import type { OrmDialect } from "./lib/orm/core/types.js";

type SemolaConfig = {
  orm: {
    dialect: OrmDialect;
    url: string;
    schema: {
      path: string;
      exportName?: string;
    };
  };
};

export const defineConfig = (config: SemolaConfig) => config;
