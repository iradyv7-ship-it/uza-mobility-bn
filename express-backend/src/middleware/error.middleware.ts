import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

/**
 * A typed error a controller can throw to get a specific status code out through the
 * one centralized handler below, instead of a scattered `try/catch { console.log }`
 * per route. `BadRequestError`, `NotFoundError` etc. below are the small vocabulary
 * this slice needs; more join as more modules port over.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, message, 'BAD_REQUEST');
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, message, 'NOT_FOUND');
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message: string) {
    super(503, message, 'SERVICE_UNAVAILABLE');
  }
}

/** Wraps an async route handler so a rejected promise reaches the error middleware
 * below instead of crashing the process — Express 4 never did this automatically;
 * Express 5 does for the common case, but being explicit here costs nothing and
 * survives a downgrade. */
export function asyncHandler<Req extends Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Req, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

/**
 * The one place a thrown error becomes an HTTP response. Consistent shape either way:
 * `{ success: false, message, error }`. Never forwards a stack trace or an internal
 * error message to the client in production — logs it server-side instead, and
 * returns a generic message, matching "production responses must not expose sensitive
 * internal information."
 */

export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  // Express only recognises a 4-argument function as error-handling middleware — the
  // arity is load-bearing even though this particular handler never calls `next`.
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: 'Validation failed',
      error: 'VALIDATION_ERROR',
      details: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  if (err instanceof HttpError) {
    res
      .status(err.status)
      .json({ success: false, message: err.message, error: err.code });
    return;
  }

  const isProd = process.env.NODE_ENV === 'production';

  console.error('[unhandled error]', err);
  res.status(500).json({
    success: false,
    message: isProd
      ? 'Internal server error'
      : err instanceof Error
        ? err.message
        : String(err),
    error: 'INTERNAL_ERROR',
  });
}
