import axios from 'axios';
import { env } from '@/shared/lib/env';

export class ApiError extends Error {
  readonly status: number;
  /**
   * The raw `message` array from the backend body, when the response carried one
   * (e.g. class-validator's per-field messages) — preserved so future forms can
   * map field-level validation errors. `message` (the flattened string) is
   * unaffected either way.
   */
  readonly details?: string[];
  /**
   * Machine-readable error code the backend attaches to 4xx bodies (e.g.
   * `USERNAME_TAKEN`, `INVALID_CREDENTIALS`, …). Undefined when the response
   * carried none — branch on this, never on the human-readable message.
   */
  readonly code?: string;
  /**
   * Extra machine-readable context the backend attached alongside `code` —
   * e.g. a `field` name for a validation error. This is the raw parsed JSON
   * error body — read specific fields off it, never render it wholesale.
   */
  readonly payload?: Record<string, unknown>;
  /**
   * Machine-readable failure code from the body's `reason` field, when present
   * (e.g. an auth failure's `'invalid_credentials' | 'username_taken'`) — lets
   * callers branch on *why* a request was denied without parsing the
   * human-facing message.
   */
  readonly reason?: string;

  constructor(
    status: number,
    message: string,
    details?: string[],
    code?: string,
    payload?: Record<string, unknown>,
    reason?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.code = code;
    this.payload = payload;
    this.reason = reason;
  }
}

/** The backend's machine-readable `code` field, if the error body carried one. */
export function extractErrorCode(body: unknown): string | undefined {
  const code = (body as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Narrow an unknown thrown value to `ApiError` and read its `code`, if any. */
export function apiErrorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

/** The parsed JSON error body, when it was an object — carries `code`'s context fields. */
export function extractErrorPayload(body: unknown): Record<string, unknown> | undefined {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : undefined;
}

export function extractErrorMessage(status: number, body: unknown): string {
  const message = (body as { message?: string | string[] } | undefined)?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join('; ');
  return `Request failed with status ${status}`;
}

/** The backend's raw `message` array, if the response body carried one — undefined otherwise. */
export function extractErrorDetails(body: unknown): string[] | undefined {
  const message = (body as { message?: string | string[] } | undefined)?.message;
  return Array.isArray(message) ? message : undefined;
}

/** The backend's machine-readable `reason` code, if the body carried a string one — undefined otherwise. */
export function extractErrorReason(body: unknown): string | undefined {
  const reason = (body as { reason?: unknown } | undefined)?.reason;
  return typeof reason === 'string' ? reason : undefined;
}

/**
 * `paramsSerializer: { indexes: null }` — without it axios's default array
 * serializer emits bracketed indices (`tagIds[]=a&tagIds[]=b`). Two things
 * downstream conspire to reject that: `express@5`'s default `query parser`
 * is `simple` (Node's `querystring`, not `qs` — express@4's default), so the
 * key never gets un-bracketed server-side and arrives literally as
 * `tagIds[]`; the global `ValidationPipe` runs `forbidNonWhitelisted: true`
 * (`backend/src/main.ts`), which then 400s on that unknown property. `{
 * indexes: null }` emits repeated bare keys instead (`tagIds=a&tagIds=b`),
 * which `simple`/`querystring` parses into an array under the plain
 * `tagIds` key — the shape any multi-select list-filter query param takes in
 * this app. This is the SHARED axios instance used by every request —
 * changing it changes every array param's wire format, not just this one
 * caller's.
 */
export const httpClient = axios.create({
  baseURL: env.apiUrl,
  paramsSerializer: { indexes: null },
});

export interface AuthHooks {
  getToken: () => string | null;
  onUnauthorized: () => void;
}

/**
 * Tracks what this module attached to each client so a second call REPLACES
 * rather than stacks. Axios has no built-in "is this attached" query, and
 * stacked handlers are silently destructive here: the second error handler
 * receives the first's `ApiError`, which carries no `.response`, so every
 * status collapses to 0 and the symptom points nowhere near the cause.
 *
 * Eject-and-replace rather than a skip-if-present guard, deliberately: a guard
 * would make a re-attach with DIFFERENT hooks — an HMR reload, or a consuming
 * app wiring auth from two entry points — silently keep the stale hooks. This
 * makes the function a "set", not an "add". Keyed by client instance, so
 * separate clients never interfere.
 */
const attached = new WeakMap<typeof httpClient, { req: number; res: number }>();

/**
 * Attaches the bearer token to every request and signs the user out on a 401.
 *
 * Takes its session access as callbacks rather than importing the store:
 * `shared` is FSD's lowest layer and must never import from `entities`. The
 * app layer supplies the session-backed implementations in main.tsx, and
 * tests supply their own.
 *
 * There is no refresh token in this starter (design §3), so a 401 has exactly
 * one meaning: the token is gone or expired. Clearing it flips RequireAuth,
 * which redirects to /login — no imperative navigation from inside an
 * interceptor, which would fight the router.
 */
export function attachAuthInterceptors(client: typeof httpClient, hooks: AuthHooks): void {
  const prior = attached.get(client);
  if (prior) {
    client.interceptors.request.eject(prior.req);
    client.interceptors.response.eject(prior.res);
  }

  const req = client.interceptors.request.use((config) => {
    const token = hooks.getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  const res = client.interceptors.response.use(
    (response) => response,
    (error) => {
      const status = error?.response?.status;
      if (status === 401) hooks.onUnauthorized();
      return Promise.reject(
        new ApiError(
          status ?? 0,
          extractErrorMessage(status ?? 0, error?.response?.data),
          extractErrorDetails(error?.response?.data),
          extractErrorCode(error?.response?.data),
          extractErrorPayload(error?.response?.data),
          extractErrorReason(error?.response?.data),
        ),
      );
    },
  );

  attached.set(client, { req, res });
}
