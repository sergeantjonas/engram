/**
 * The API is a separate origin (`WEB_ORIGIN` on its side, `VITE_API_ORIGIN`
 * here), so every call names it absolutely and sends credentials: the session
 * is a cookie, and a cross-origin fetch drops cookies unless told otherwise.
 */
export const API_ORIGIN: string = import.meta.env.VITE_API_ORIGIN ?? 'http://localhost:2012';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The API's `error` code, or `http_${status}` when the body carried none. */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: string;
  message?: string;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: 'include',
    headers: { accept: 'application/json', ...init.headers },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    throw new ApiError(
      response.status,
      body.error ?? `http_${response.status}`,
      body.message ?? response.statusText,
    );
  }

  // 204 carries no body, and `json()` on an empty body throws.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function postJson<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}
