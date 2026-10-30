import { api, ApiError } from '@/api/client'
import { commissionInvoicePdf, exportInvoices, invoicePdf, listCommissionInvoices, listInvoices } from './invoices'

jest.mock('@/api/client', () => ({ ...jest.requireActual('@/api/client'), api: jest.fn() }))

beforeEach(() => (api as jest.Mock).mockReset().mockResolvedValue({ docs: [] }))
const last = () => (api as jest.Mock).mock.calls.at(-1)

test('the lists read /invoices and /commission-invoices and return their docs', async () => {
  ;(api as jest.Mock).mockResolvedValueOnce({ docs: [{ id: 'i1' }] })
  expect(await listInvoices()).toEqual([{ id: 'i1' }])
  expect(last()).toEqual(['/app-api/v1/invoices'])
  ;(api as jest.Mock).mockResolvedValueOnce({ docs: [{ id: 'c1' }] })
  expect(await listCommissionInvoices()).toEqual([{ id: 'c1' }])
  expect(last()).toEqual(['/app-api/v1/commission-invoices'])
})

test('the PDF links are read per id, the id encoded', async () => {
  ;(api as jest.Mock).mockResolvedValue({ url: 'https://files.test/a.pdf' })
  expect(await invoicePdf('a b')).toEqual({ url: 'https://files.test/a.pdf' })
  expect(last()).toEqual(['/app-api/v1/invoices/a%20b/pdf'])
  await commissionInvoicePdf('c/1')
  expect(last()).toEqual(['/app-api/v1/commission-invoices/c%2F1/pdf'])
})

test('the yearly export reads ?year= as text', async () => {
  ;(api as jest.Mock).mockResolvedValue('﻿number,date\r\n')
  expect(await exportInvoices(2026)).toBe('﻿number,date\r\n')
  expect(last()).toEqual(['/app-api/v1/invoices/export?year=2026', { text: true }])
})

test('an empty export answer is a failed read; server refusals pass through with their code', async () => {
  ;(api as jest.Mock).mockResolvedValueOnce('')
  await expect(exportInvoices(2026)).rejects.toMatchObject({ status: 0, code: 'network' })
  ;(api as jest.Mock).mockRejectedValueOnce(new ApiError(400, 'BAD_YEAR'))
  await expect(exportInvoices(1999)).rejects.toMatchObject({ status: 400, code: 'BAD_YEAR' })
  ;(api as jest.Mock).mockRejectedValueOnce(new ApiError(404, 'Not found'))
  await expect(invoicePdf('x')).rejects.toMatchObject({ status: 404 })
})
