import type {
  Api2Options,
  Context,
  MethodRoutes,
  ResponseSchema,
  RouteConfig,
} from "./types.js";

export class Api2 {
  private options: Api2Options;
  private routes: RouteConfig[] = [];

  public constructor(options: Api2Options) {
    this.options = options;
  }

  private getFullPath(path: string) {
    if (!this.options.prefix) return path;

    const fullPath = this.options.prefix + path;

    // Remove trailing slash
    if (fullPath.endsWith("/")) {
      return fullPath.slice(0, -1);
    }

    return fullPath;
  }

  private createContext(request: Request) {
    const c: Context = {
      raw: request,
      json: (status, data) => Response.json(data, { status }),
      text: (status, text) => new Response(text, { status }),
    };

    return c;
  }

  private buildBunRoutes() {
    const bunRoutes: MethodRoutes = {};

    for (const route of this.routes) {
      const { path, method, handler } = route;

      const fullPath = this.getFullPath(path);

      if (!bunRoutes[fullPath]) {
        bunRoutes[fullPath] = {};
      }

      bunRoutes[fullPath][method] = (request) => {
        const c = this.createContext(request);

        return handler(c);
      };
    }

    return bunRoutes;
  }

  public defineRoute<T extends ResponseSchema>(config: RouteConfig<T>) {
    this.routes.push(config);
  }

  public serve(port: number) {
    const bunRoutes = this.buildBunRoutes();

    return Bun.serve({
      port,
      routes: bunRoutes,
      fetch: () => new Response("Not found", { status: 404 }),
    });
  }
}
