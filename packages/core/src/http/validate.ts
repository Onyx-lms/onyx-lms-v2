/** P-08 -- Zod -> Laravel-shaped validation errors. */
import { z } from 'zod';
import { HttpError } from './errors.ts';

export function validate<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;

  const errors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.') || '_';
    (errors[key] ??= []).push(issue.message);
  }
  throw new HttpError(422, 'The given data was invalid.', { errors });
}
