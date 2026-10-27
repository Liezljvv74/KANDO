/**
 * Creates a record on the first choice and updates it on later ones. A choice made while the create is still in flight
 * waits for it and then updates, so a double choice never creates two records.
 */
export function createSerial<T extends { id: string }>(initialId: string | null, create: (choice: string) => Promise<T>, update: (id: string, choice: string) => Promise<T>) {
  let id = initialId
  let pending: Promise<T> | null = null
  return {
    creating: () => pending !== null,
    async choose(choice: string): Promise<T> {
      if (pending) return update((await pending).id, choice)
      if (id) return update(id, choice)
      const p = (pending = create(choice))
      try {
        const s = await p
        id = s.id
        return s
      } finally {
        pending = null
      }
    },
  }
}
