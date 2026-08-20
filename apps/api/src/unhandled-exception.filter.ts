import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import type { Logger } from "pino";

/**
 * Logs unexpected errors before returning the anonymous 500 response. The
 * Nest logger is disabled in main.ts, so without this filter an unhandled
 * exception produces a bare 500 with no server-side trace.
 */
@Catch()
export class UnhandledExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const error =
      exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error({
      err: { message: error.message, name: error.name, stack: error.stack },
      event: "http.request.unhandled_error",
    });
    response.status(500).json({
      message: "Internal server error",
      statusCode: 500,
    });
  }
}
