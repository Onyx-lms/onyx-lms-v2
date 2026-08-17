/**
 * P-08 -- error envelope.
 *
 * Laravel signals outcomes through flash messages (`success`, `error`,
 * `warning`) and returns field-keyed validation errors. The React client needs
 * the same three levels so ported screens can show the same toasts without
 * inventing a new convention per endpoint.
 */
export type FlashLevel = 'success' | 'error' | 'warning' | 'info';

export interface ApiError {
  ok: false;
  level: FlashLevel;
  message: string;
  /** field -> messages, matching Laravel's validation error bag */
  errors?: Record<string, string[]>;
  code?: string;
}

export interface ApiOk<T> {
  ok: true;
  data: T;
  level?: FlashLevel;
  message?: string;
}

export type ApiResult<T> = ApiOk<T> | ApiError;

export class HttpError extends Error {
  readonly status: number;
  readonly level: FlashLevel;
  readonly errors?: Record<string, string[]>;
  readonly code?: string;

  constructor(status: number, message: string, opts: {
    level?: FlashLevel; errors?: Record<string, string[]>; code?: string;
  } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.level = opts.level ?? 'error';
    if (opts.errors) this.errors = opts.errors;
    if (opts.code) this.code = opts.code;
  }

  toBody(): ApiError {
    const body: ApiError = { ok: false, level: this.level, message: this.message };
    if (this.errors) body.errors = this.errors;
    if (this.code) body.code = this.code;
    return body;
  }
}

export const badRequest = (m: string, errors?: Record<string, string[]>) =>
  new HttpError(422, m, errors ? { errors } : {});
export const unauthorized = (m = 'Unauthenticated.') => new HttpError(401, m);
export const forbidden = (m = 'This action is unauthorized.') => new HttpError(403, m);
export const notFound = (m = 'Not found.') => new HttpError(404, m);
export const tooManyRequests = (m = 'Too Many Attempts.') => new HttpError(429, m);

export function ok<T>(data: T, message?: string, level: FlashLevel = 'success'): ApiOk<T> {
  return message ? { ok: true, data, message, level } : { ok: true, data };
}
