import type { Invoice } from '@kando/contract'

import { ApiError } from '@/api/client'
import { pushRoute } from '@/lib/push'
import { clampYear, exportYears, invoiceEntries, invoiceForBooking, openPdf, YEAR_MIN } from './invoices'

jest.mock('@/api/client', () => ({ ...jest.requireActual('@/api/client'), api: jest.fn() }))
jest.mock('@/api/push', () => ({}))
jest.mock('expo-notifications', () => ({}))
jest.mock('expo-device', () => ({}))
jest.mock('expo-constants', () => ({}))

test('customers see only their invoices; providers also commission invoices and the yearly export', () => {
  expect(invoiceEntries({ isProvider: false })).toEqual({ invoices: true, commission: false, export: false })
  expect(invoiceEntries(null)).toEqual({ invoices: true, commission: false, export: false })
  expect(invoiceEntries({ isProvider: true })).toEqual({ invoices: true, commission: true, export: true })
})

test('the export year stays within 2020..next year; the default is this year', () => {
  const now = new Date('2026-06-15T12:00:00Z')
  expect(YEAR_MIN).toBe(2020)
  expect(clampYear(2026, now)).toBe(2026)
  expect(clampYear(2019, now)).toBe(2020)
  expect(clampYear(2030, now)).toBe(2027)
  expect(clampYear(2025.5, now)).toBe(2025)
  expect(clampYear(NaN, now)).toBe(2026)
  expect(exportYears(now)).toEqual([2027, 2026, 2025, 2024, 2023, 2022, 2021, 2020])
})

const inv = (o: Partial<Invoice>): Invoice => ({ id: 'i', number: 'N', kind: 'invoice', role: 'customer', bookingId: 'root', issuedAt: '2026-01-01T00:00:00Z', total: 10, currency: 'EUR', counterparty: 'A', pdfReady: true, ...o })

test('a booking shows the invoice or receipt of its root (an additional task its parent), labelled by kind', () => {
  const list = [inv({ id: 'r1', bookingId: 'other' }), inv({ id: 'r2', bookingId: 'root', kind: 'receipt' })]
  expect(invoiceForBooking(list, { id: 'root', parentBookingId: null })).toEqual({ invoice: list[1], label: 'invoice.receipt' })
  expect(invoiceForBooking(list, { id: 'child', parentBookingId: 'root' })?.invoice).toBe(list[1])
  expect(invoiceForBooking([inv({ bookingId: 'root' })], { id: 'root', parentBookingId: null })?.label).toBe('invoice.invoice')
  expect(invoiceForBooking(list, { id: 'none', parentBookingId: null })).toBeNull()
  expect(invoiceForBooking(undefined, { id: 'root', parentBookingId: null })).toBeNull()
})

test('opening a PDF fetches a fresh link each time and asks once more after a 404', async () => {
  const open = jest.fn().mockResolvedValue(undefined)
  const get = jest.fn().mockRejectedValueOnce(new ApiError(404, 'Not found')).mockResolvedValueOnce({ url: 'https://files.test/a.pdf' })
  await openPdf(get, open)
  expect(get).toHaveBeenCalledTimes(2)
  expect(open).toHaveBeenCalledWith('https://files.test/a.pdf')
})

test('a second 404, a not-ready PDF or a link that is not https is an error, never opened', async () => {
  const open = jest.fn()
  const gone = jest.fn().mockRejectedValue(new ApiError(404, 'Not found'))
  await expect(openPdf(gone, open)).rejects.toMatchObject({ status: 404 })
  expect(gone).toHaveBeenCalledTimes(2)
  const notReady = jest.fn().mockRejectedValue(new ApiError(409, 'NOT_READY'))
  await expect(openPdf(notReady, open)).rejects.toMatchObject({ code: 'NOT_READY' })
  expect(notReady).toHaveBeenCalledTimes(1)
  await expect(openPdf(async () => ({ url: 'http://files.test/a.pdf' }), open)).rejects.toBeTruthy()
  expect(open).not.toHaveBeenCalled()
})

test('push links land on a route that exists: invoice-ready on the booking, invoices/<id> and the commission list on the invoice screens', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require('fs')
  const path = require('path')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const app = path.join(process.cwd(), 'src', 'app')
  const exists = (route: string) => [`${route}.tsx`, `${route}/index.tsx`].some((f) => fs.existsSync(path.join(app, f)))
  expect(pushRoute('skilled://bookings/0b6e2c1a-root')).toBe('/bookings/0b6e2c1a-root') // invoice-ready sends the root booking
  expect(exists('bookings/[id]')).toBe(true)
  expect(pushRoute('skilled://invoices/9f1c')).toBe('/invoices/9f1c')
  expect(exists('invoices/[id]')).toBe(true)
  expect(pushRoute('skilled://invoices/commission')).toBe('/invoices/commission')
  expect(exists('invoices/commission')).toBe(true)
  expect(exists('invoices')).toBe(true)
})
