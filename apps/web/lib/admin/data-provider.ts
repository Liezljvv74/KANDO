import type { BaseRecord, CrudFilter, DataProvider, HttpError } from '@refinedev/core'

import { DEFAULT_LANG, t, type Lang } from '@kando/i18n'

const API = '/api/admin'

let errorLang: Lang = DEFAULT_LANG
/** The shell sets the back office language, so every failed request is worded in it. */
export const setErrorLang = (lang: Lang) => {
  errorLang = lang
}

/** What went wrong, the likely cause and what to do next (the raw server text is English and has no next step). Status 0: no answer. */
export function friendlyError(lang: Lang, status: number, detail?: string): string {
  if (status === 404) return t(lang, 'admin.error.gone')
  if (status === 401 || status === 403) return t(lang, 'admin.error.forbidden')
  if ((status === 400 || status === 409 || status === 422) && detail) return t(lang, 'admin.error.rejected', { detail })
  return t(lang, 'admin.error.failed')
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw { message: friendlyError(errorLang, 0), statusCode: 0 } satisfies HttpError
  }
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string }
    throw { message: friendlyError(errorLang, res.status, e.error), statusCode: res.status } satisfies HttpError
  }
  return (res.status === 204 ? {} : await res.json()) as T
}

/** Refine filters to the one JSON object the admin API reads: `{ q: "text", status: "pending", ... }`. */
const filterOf = (filters: CrudFilter[] = []) =>
  Object.fromEntries(filters.flatMap((f) => ('field' in f && f.value !== undefined && f.value !== '' && f.value !== null ? [[f.field, f.value]] : [])))

/** The REST data provider of the back office: lists answer `{ data, total }`, the rest `{ data }`. */
export const dataProvider: DataProvider = {
  getApiUrl: () => API,
  async getList({ resource, pagination, sorters, filters }) {
    const q = new URLSearchParams({ page: String(pagination?.currentPage ?? 1), pageSize: String(pagination?.pageSize ?? 25) })
    if (sorters?.[0]) q.set('sort', `${sorters[0].field}:${sorters[0].order}`)
    const filter = filterOf(filters)
    if (Object.keys(filter).length) q.set('filter', JSON.stringify(filter))
    return call(`${API}/${resource}?${q}`)
  },
  getOne: ({ resource, id }) => call(`${API}/${resource}/${id}`),
  create: ({ resource, variables }) => call(`${API}/${resource}`, 'POST', variables),
  update: ({ resource, id, variables }) => call(`${API}/${resource}/${id}`, 'PATCH', variables),
  async deleteOne({ resource, id }) {
    await call(`${API}/${resource}/${id}`, 'DELETE')
    return { data: { id } as BaseRecord } as never
  },
  // Actions that are not plain CRUD: review, suspend, set staff role (the caller passes the full URL).
  custom: ({ url, method, payload }) => call(url, method.toUpperCase(), payload),
}
