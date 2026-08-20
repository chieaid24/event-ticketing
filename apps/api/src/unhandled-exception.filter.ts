import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import type { Logger } from "pino";

// log unhandled errors while the framework logger is off
@Catch()
export class UnhandledExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    // preserve status from lower-level http errors
    if (
      exception instanceof Error &&
      "statusCode" in exception &&
      typeof exception.statusCode === "number"
    ) {
      response.status(exception.statusCode).json({
        message: exception.message,
        statusCode: exception.statusCode,
      });
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
