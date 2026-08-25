import 'server-only';
import { dispatchApi } from '@/server/api-dispatch';
import { appOrigin } from '@/lib/app-origin';

/**
 * A server component asking the API a question, without leaving the process.
 *
 * **The single largest source of latency in this product, removed.** Every
 * server-rendered page fetched its own API at its own public hostname —
 * `https://onyx-lms-v2.vercel.app/api/onyx/...` — which means the request left
 * the function, crossed the CDN, completed a TLS handshake, woke a second
 * serverless invocation, and came back. Measured across the whole product that
 * was 250–350ms per call before a single row was read, and a page makes three
 * or four calls. Most of a second on every navigation was the application
 * phoning itself.
 *
 * The route handler is an ordinary async function that takes a `Request`, so
 * it can simply be called. Nothing else changes: the same route table, the
 * same guards, the same envelope, the same audit trail, the same errors.
 * `cookies()` inside the handler still resolves, because a server component
 * runs inside the same request context.
 *
 * **What this is not.** It is not a way to skip authentication. The handler
 * reads the session exactly as it does over HTTP — a page calling a route it
 * has no token for gets the same 401 it would have got, which is the point:
 * there is one implementation of who may read what, and this does not become
 * a second door into it.
 *
 * A browser still goes over HTTP through `/api/proxy/*`. This is only for code
 * already running on the server.
 */
export async function callApi(
  path: string, init?: RequestInit & { token?: string | null },
): Promise<Response> {
  const url = new URL(path, appOrigin());
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (init?.token) headers.set('Authorization', 'Bearer ' + init.token);

  const request = new Request(url, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body,
  });

  /*
   * The path segments the catch-all would have parsed out of the URL.
   *
   * The handler takes them as a promise because Next hands it one; here they
   * are simply known. `/api/` is dropped, and an empty trailing segment with
   * it -- `/api/onyx/me/` and `/api/onyx/me` are the same route.
   */
  const segments = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  return await dispatchApi(request, Promise.resolve({ path: segments }));
}

/** The envelope, unwrapped — the same contract the HTTP helpers had. */
export async function callApiJson<T>(
  path: string, init?: RequestInit & { token?: string | null },
): Promise<T> {
  const res = await callApi(path, init);
  const body = await res.json().catch(() => ({ ok: false, message: 'Bad response' }));
  if (!body.ok) throw new Error(body.message || 'Request failed: ' + path);
  return body.data as T;
}
