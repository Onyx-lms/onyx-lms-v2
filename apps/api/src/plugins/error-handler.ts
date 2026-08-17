import type { FastifyError, FastifyInstance } from 'fastify';
import { HttpError } from '@onyx/core';

/** P-08: every failure leaves through one envelope. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send(err.toBody());
    }
    app.log.error({ err }, 'unhandled error');
    const production = process.env.NODE_ENV === 'production';
    return reply.status(500).send({
      ok: false,
      level: 'error',
      message: production ? 'Something went wrong.' : err.message,
    });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ ok: false, level: 'error', message: 'Not found.' }));
}
