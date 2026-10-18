/** Thrown for any non-2xx response (and network failures, status 0). `code` is the server's `{error}` code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** `path` is relative to `/api`, e.g. `apiGet('/auth/me')`. */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const code = (data as { error?: unknown } | undefined)?.error;
    throw new ApiError(res.status, typeof code === 'string' ? code : 'generic');
  }
  return data as T;
}

export const apiGet = <T>(path: string) => request<T>('GET', path);
export const apiPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
export const apiPatch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {});
export const apiPut = <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {});
export const apiDelete = <T>(path: string) => request<T>('DELETE', path);
