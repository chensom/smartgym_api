/** Error de negocio con código HTTP. El errorHandler global lo responde tal cual. */
export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export const esHttpError = (e: unknown): e is HttpError =>
  e instanceof HttpError ||
  (typeof e === 'object' && e !== null && typeof (e as any).status === 'number' &&
   (e as any).status >= 400 && (e as any).status < 500);
