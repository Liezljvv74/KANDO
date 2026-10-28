/** Throws unless url is a local Docker test database (`kando` or `kando_<suffix>`, so parallel worktrees can each have one) and not a configured app database. */
export function assertTestDatabase(url: string): void {
  const u = new URL(url)
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  const same = [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED].includes(url)
  if (!local || !/^\/kando(_[a-z0-9]+)?$/.test(u.pathname) || same) {
    throw new Error(`Refusing to reset ${u.hostname}${u.pathname}: not the local test database`)
  }
}
