// The mobile package has no Node typings, so the two Node modules are typed here by hand.
declare const require: (id: string) => unknown
declare const __dirname: string
const { readdirSync, readFileSync } = require('fs') as {
  readdirSync: (dir: string, o: { withFileTypes: true }) => { name: string; isDirectory(): boolean }[]
  readFileSync: (f: string) => { toString(enc: 'utf8'): string }
}
const { join } = require('path') as { join: (...p: string[]) => string }

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []))

test('no source file under src holds U+FFFD or invalid UTF-8', () => {
  const bad = walk(join(__dirname, '..')).filter((f) => readFileSync(f).toString('utf8').includes(String.fromCharCode(0xfffd)))
  expect(bad).toEqual([])
})
