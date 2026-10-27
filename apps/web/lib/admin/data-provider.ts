import type { BaseRecord, CrudFilter, DataProvider, HttpError } from '@refinedev/core'

const API = '/api/admin'

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string }
    throw { message: e.error ?? res.statusText, statusCode: res.status } satisfies HttpError
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
