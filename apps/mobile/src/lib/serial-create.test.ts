import { createSerial } from './serial-create'

test('choosing twice before the create returns creates once, then updates', async () => {
  let resolve!: (s: { id: string }) => void
  const create = jest.fn(() => new Promise<{ id: string }>((r) => (resolve = r)))
  const update = jest.fn(async (id: string, c: string) => ({ id, c }))
  const serial = createSerial(null, create, update)
  const a = serial.choose('c1')
  const b = serial.choose('c2')
  expect(serial.creating()).toBe(true)
  resolve({ id: 's1' })
  await a
  await b
  expect(create).toHaveBeenCalledTimes(1)
  expect(update).toHaveBeenCalledWith('s1', 'c2')
  expect(serial.creating()).toBe(false)
})

test('an existing id is only updated', async () => {
  const create = jest.fn()
  const update = jest.fn(async (id: string) => ({ id }))
  await createSerial('s9', create, update).choose('c1')
  expect(create).not.toHaveBeenCalled()
  expect(update).toHaveBeenCalledWith('s9', 'c1')
})
