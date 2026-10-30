/** Throws a JSON Response; the app wrapper returns it as the answer and rolls the transaction back. */
export const fail = (status: number, body: object): never => {
  throw Response.json(body, { status })
}

/** The 404 every lookup answers for something missing or not the caller's (thrown, like fail). */
export const notFound = (): never => fail(404, { error: 'Not found' })
