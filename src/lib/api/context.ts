import type {
  ApiError,
  HandlerContext,
  RequestSchema,
  ResponseSchema,
} from "./types.js";
import type { ValidationResult } from "./validator.js";

type ValidatedData = {
  body?: unknown;
  params?: unknown;
  query?: unknown;
  headers?: unknown;
  cookies?: unknown;
};

type ValidateResponseFn = (
  status: number,
  data: unknown,
) => Promise<ValidationResult<unknown>>;

type HandleErrorFn = (error: ApiError) => Promise<Response>;

export class RequestContext<
  TRequest extends RequestSchema = RequestSchema,
  TResponse extends ResponseSchema = ResponseSchema,
> implements HandlerContext<TRequest, TResponse>
{
  public body: HandlerContext<TRequest, TResponse>["body"];
  public params: HandlerContext<TRequest, TResponse>["params"];
  public query: HandlerContext<TRequest, TResponse>["query"];
  public headers: HandlerContext<TRequest, TResponse>["headers"];
  public cookies: HandlerContext<TRequest, TResponse>["cookies"];
  public raw: Request;
  private validateResponse: ValidateResponseFn;
  private handleError: HandleErrorFn;

  constructor(
    request: Request,
    validatedData: ValidatedData,
    validateResponse: ValidateResponseFn,
    handleError: HandleErrorFn,
  ) {
    this.raw = request;
    this.body = validatedData.body as HandlerContext<
      TRequest,
      TResponse
    >["body"];
    this.params = validatedData.params as HandlerContext<
      TRequest,
      TResponse
    >["params"];
    this.query = validatedData.query as HandlerContext<
      TRequest,
      TResponse
    >["query"];
    this.headers = validatedData.headers as HandlerContext<
      TRequest,
      TResponse
    >["headers"];
    this.cookies = validatedData.cookies as HandlerContext<
      TRequest,
      TResponse
    >["cookies"];
    this.validateResponse = validateResponse;
    this.handleError = handleError;
  }

  public async json(status: number, data: unknown): Promise<Response> {
    const [error, validatedData] = await this.validateResponse(status, data);

    if (error) {
      return this.handleError({
        type: "InternalServerError",
        message: "Invalid response data",
        context: { statusCode: 500 },
      });
    }

    return Response.json(validatedData, { status });
  }

  public text(status: number, text: string): Response {
    return new Response(text, {
      status,
      headers: { "Content-Type": "text/plain" },
    });
  }

  public html(status: number, html: string): Response {
    return new Response(html, {
      status,
      headers: { "Content-Type": "text/html" },
    });
  }

  public redirect(status: number, url: string): Response {
    return Response.redirect(url, status);
  }
}
