export interface ApiResponse<T = unknown> {
  ok:       boolean;
  data?:    T;
  error?:   string;
  message?: string;
  meta?:    PaginationMeta;
}

export interface PaginationMeta {
  total: number;
  page:  number;
  limit: number;
  pages: number;
}

export const ok = <T>(data: T, message?: string, meta?: PaginationMeta): ApiResponse<T> =>
  ({ ok: true, data, message, meta });

export const err = (error: string): ApiResponse =>
  ({ ok: false, error });

export const paginate = (total: number, page: number, limit: number): PaginationMeta => ({
  total,
  page,
  limit,
  pages: Math.ceil(total / limit),
});
