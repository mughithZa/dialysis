export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'HttpError';
  }
}

export const notFound = () => new HttpError(404, 'not_found');
export const forbidden = () => new HttpError(403, 'forbidden');
export const conflict = (code: string) => new HttpError(409, code);
export const badRequest = (code: string) => new HttpError(400, code);
