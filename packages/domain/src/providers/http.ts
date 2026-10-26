/** Throws a JSON Response; the app wrapper returns it as the answer and rolls the transaction back. */
export const fail = (status: number, body: object): never => {
  throw Response.json(body, { status })
}
