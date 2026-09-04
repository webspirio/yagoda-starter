import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorEnvelope {
  statusCode: number;
  error: string;
  message: string | string[];
  reason?: string;
  path: string;
  timestamp: string;
  requestId?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request & { id?: string }>();
    const response = ctx.getResponse<Response>();

    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message: string | string[] = 'Internal server error';
    // Machine-readable extras (design §3 error contract): an HttpException
    // constructed with an object may carry a `code` plus context fields
    // (e.g. { code: 'USERNAME_TAKEN', field: 'username' }) — pass them
    // through into the JSON error body so clients can branch without parsing
    // human-readable messages. `reason` is hoisted to a first-class envelope
    // field alongside this generic passthrough.
    let extras: Record<string, unknown> = {};
    let reason: string | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        error = exception.name;
      } else {
        const obj = body as {
          error?: string;
          message?: string | string[];
          reason?: string;
          statusCode?: number;
          [key: string]: unknown;
        };
        message = obj.message ?? exception.message;
        error = obj.error ?? exception.name;
        reason = obj.reason;
        extras = Object.fromEntries(
          Object.entries(obj).filter(
            ([key]) => !['statusCode', 'error', 'message', 'reason'].includes(key),
          ),
        );
      }
    } else {
      // Unknown error: log the full details, never leak internals in the response.
      this.logger.error(
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
      );
      this.reportError(exception, request.id);
    }

    const envelope: ErrorEnvelope = {
      statusCode,
      error,
      message,
      reason,
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId: request.id,
    };

    // Envelope keys always win over same-named extras.
    response.status(statusCode).json({ ...extras, ...envelope });
  }

  // Wire your error tracker here (Sentry/Bugsnag/…) — every unexpected
  // (non-HttpException) error flows through this single hook. Mirrors the
  // frontend stub in frontend/src/shared/lib/error-reporting.
  private reportError(_error: unknown, _requestId?: string): void {
    // no-op until an error tracker is added
  }
}
