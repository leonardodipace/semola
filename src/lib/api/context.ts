import type {
  ApiError,
  HandlerContext,
  InferInput,
  RequestSchema,
  ResponseSchema,
} from "./types.js";
import type { ValidationResult } from "./validator.js";

type ValidatedData<TRequest extends RequestSchema> = {
  body: InferInput<TRequest["body"]>;
  params: InferInput<TRequest["params"]>;
  query: InferInput<TRequest["query"]>;
  headers: InferInput<TRequest["headers"]>;
  cookies: InferInput<TRequest["cookies"]>;
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
  public request: HandlerContext<TRequest, TResponse>["request"];
  public raw: Request;
  private validateResponse: ValidateResponseFn;
  private handleError: HandleErrorFn;

  constructor(
    request: Request,
    validatedData: ValidatedData<TRequest>,
    validateResponse: ValidateResponseFn,
    handleError: HandleErrorFn,
  ) {
    this.raw = request;
    this.request = {
      body: validatedData.body,
      params: validatedData.params,
      query: validatedData.query,
      headers: validatedData.headers,
      cookies: validatedData.cookies,
    };
    this.validateResponse = validateResponse;
    this.handleError = handleError;
  }

  public async json(status: number, data: unknown) {
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

  public text(status: number, text: string) {
    return new Response(text, {
      status,
      headers: { "Content-Type": "text/plain" },
    });
  }

  public html(status: number, html: string) {
    return new Response(html, {
      status,
      headers: { "Content-Type": "text/html" },
    });
  }

  public redirect(status: number, url: string) {
    return Response.redirect(url, status);
  }
}
