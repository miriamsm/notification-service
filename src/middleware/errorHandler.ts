/**
 * Error Handler Middleware
 * 
 * Purpose: Centralized error handling for Express
 * 
 * Why centralized error handling?
 * - Consistent error response format
 * - Single place to log errors
 * - Prevents error details from leaking to clients
 * - Easier to integrate error tracking (Sentry, Datadog)
 * 
 * How Express error handling works:
 * 1. Error thrown or passed to next(error)
 * 2. Express skips all normal middleware
 * 3. Express finds error handler (4 parameters)
 * 4. Error handler sends response
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Custom Error Classes
 * 
 * Why create custom errors?
 * - Distinguish between error types
 * - Attach HTTP status codes
 * - Add additional context
 * - Type-safe error handling
 */

/**
 * Base API Error
 * 
 * All custom errors extend this
 */
export class ApiError extends Error {
  statusCode: number;           // HTTP status code
  isOperational: boolean;       // Is this an expected error?
  
  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    
    /**
     * Maintain proper stack trace
     * 
     * Without this, stack trace points to ApiError constructor
     * With this, stack trace points to where error was thrown
     */
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 400 Bad Request
 * 
 * Client sent invalid data
 * Example: Missing required field, invalid format
 */
export class BadRequestError extends ApiError {
  constructor(message: string = 'Bad Request') {
    super(message, 400);
  }
}

/**
 * 404 Not Found
 * 
 * Requested resource doesn't exist
 * Example: Notification ID not found
 */
export class NotFoundError extends ApiError {
  constructor(message: string = 'Resource not found') {
    super(message, 404);
  }
}

/**
 * 409 Conflict
 * 
 * Request conflicts with current state
 * Example: Duplicate notification (idempotency)
 */
export class ConflictError extends ApiError {
  constructor(message: string = 'Conflict') {
    super(message, 409);
  }
}

/**
 * 500 Internal Server Error
 * 
 * Unexpected server error
 * Example: Database down, unhandled exception
 */
export class InternalServerError extends ApiError {
  constructor(message: string = 'Internal Server Error') {
    super(message, 500, false); // isOperational = false
  }
}

/**
 * Error Handler Middleware
 * 
 * MUST have 4 parameters (Express recognizes it as error handler)
 * 
 * Parameters:
 * - err: The error object
 * - req: Request object (for logging context)
 * - res: Response object (to send error response)
 * - next: Next function (rarely used in error handler)
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  /**
   * Step 1: Extract error information
   * 
   * If custom ApiError: use its statusCode
   * Otherwise: default to 500
   */
  let statusCode = 500;
  let message = 'Internal Server Error';
  let isOperational = false;
  
  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    isOperational = err.isOperational;
  }
  
  /**
   * Step 2: Log error
   * 
   * Log level depends on error type:
   * - Operational errors (4xx): warn level
   * - Server errors (5xx): error level
   * 
   * What to log:
   * - Timestamp (automatic in most loggers)
   * - Error message
   * - Stack trace (for debugging)
   * - Request details (method, URL, user)
   * - Status code
   */
  const errorLog = {
    timestamp: new Date().toISOString(),
    statusCode,
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  };
  
  if (isOperational) {
    // Expected errors (client mistakes)
    console.warn('Operational Error:', JSON.stringify(errorLog, null, 2));
  } else {
    // Unexpected errors (server problems)
    console.error('Server Error:', JSON.stringify(errorLog, null, 2));
    
    /**
     * In production: Send to error tracking service
     * 
     * Example with Sentry:
     * Sentry.captureException(err, {
     *   tags: { statusCode },
     *   extra: { req: { method: req.method, url: req.url } }
     * });
     */
  }
  
  /**
   * Step 3: Send error response
   * 
   * Different response based on environment
   * - Development: Include stack trace (helps debugging)
   * - Production: Hide stack trace (security)
   */
  const response: any = {
    success: false,
    error: message,
  };
  
  /**
   * Include stack trace in development
   * 
   * Environment check:
   * NODE_ENV=development → include stack
   * NODE_ENV=production → hide stack
   */
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
    response.details = errorLog;
  }
  
  /**
   * Send response
   * 
   * Status code determines HTTP status
   * JSON body contains error details
   */
  res.status(statusCode).json(response);
}

/**
 * Not Found Handler
 * 
 * Catches requests to non-existent routes
 * 
 * Usage: Add as last route
 * app.use(notFoundHandler);
 * 
 * Why separate from errorHandler?
 * - 404 is not an error, it's expected
 * - Different logging level
 * - Clearer separation of concerns
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const error = new NotFoundError(`Route ${req.method} ${req.url} not found`);
  next(error); // Pass to errorHandler
}

/**
 * Async Error Wrapper
 * 
 * Purpose: Catch errors in async route handlers
 * 
 * Problem:
 * async function handler(req, res) {
 *   await db.query(); // If this throws, Express won't catch it!
 * }
 * 
 * Solution:
 * const handler = asyncHandler(async (req, res) => {
 *   await db.query(); // Errors caught and passed to errorHandler
 * });
 * 
 * How it works:
 * - Wraps async function in try-catch
 * - If error occurs, passes it to next(error)
 * - Express then calls errorHandler
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    /**
     * Execute async function
     * 
     * Promise.resolve(fn(req, res, next))
     * - Ensures fn returns a Promise (even if it's not async)
     * 
     * .catch(next)
     * - If Promise rejects, pass error to next
     * - Express will call errorHandler
     */
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}