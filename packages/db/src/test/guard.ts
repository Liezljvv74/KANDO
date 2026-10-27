/** Throws unless url is the local Docker test database and not a configured app database. */
export function assertTestDatabase(url: string): void {
  const u = new URL(url)
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  const same = [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED].includes(url)
  if (!local || u.pathname !== '/kando' || same) {
    throw new Error(`Refusing to reset ${u.hostname}${u.pathname}: not the local test database`)
  }
}
