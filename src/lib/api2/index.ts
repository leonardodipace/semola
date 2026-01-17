import type {
  Api2Options,
  Context,
  MethodRoutes,
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

    return this.options.prefix + path;
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

  public defineRoute(config: RouteConfig) {
    this.routes.push(config);
  }

  public serve(port: number) {
    const bunRoutes = this.buildBunRoutes();

    return Bun.serve({
      port,
      routes: bunRoutes,
    });
  }
}
