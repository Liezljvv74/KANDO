import { getAuth } from '../../../../lib/auth/server'

type Ctx = { params: Promise<{ path: string[] }> }
const h =
  (method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH') =>
  (request: Request, ctx: Ctx) =>
    getAuth().handler()[method](request, ctx)

export const GET = h('GET')
export const POST = h('POST')
export const PUT = h('PUT')
export const DELETE = h('DELETE')
export const PATCH = h('PATCH')
