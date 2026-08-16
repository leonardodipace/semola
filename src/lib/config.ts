export type SemolaConfig = {
  orm: {
    schema: string;
    migrationsDir?: string;
  };
};

export const defineConfig = <const T extends SemolaConfig>(config: T) => {
  return config;
};
