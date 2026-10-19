// End-to-end tests: copy the sample project, change it, and run the real CLI on it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'dist', 'cli.js')

function withSample(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'archguard-'))
  cpSync(join(root, 'sample'), dir, { recursive: true })
  try { return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

const run = (dir, ...args) => spawnSync('node', [cli, 'check', ...args], { cwd: dir, encoding: 'utf8' })

test('reports the deliberate violation and fails', () => withSample(dir => {
  const r = run(dir, '--json')
  assert.equal(r.status, 1)
  const result = JSON.parse(r.stdout)
  assert.equal(result.violations.length, 1)
  assert.equal(result.violations[0].from.id, 'shop.web')
  assert.equal(result.violations[0].to.id, 'shop.db')
}))

test('passes once the code is fixed', () => withSample(dir => {
  const page = join(dir, 'src/web/page.ts')
  writeFileSync(page, readFileSync(page, 'utf8')
    .replace("import { allOrders } from '../db/store'", '')
    .replace("import { placeOrder } from '../orders/orders'", "import { placeOrder, listOrders } from '../orders/orders'")
    .replace('allOrders()', 'listOrders()'))
  const r = run(dir)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /matches the architecture/)
}))

test('passes once the relationship is added to the model', () => withSample(dir => {
  const model = join(dir, 'architecture/model.c4')
  writeFileSync(model, readFileSync(model, 'utf8')
    .replace("orders -> db 'stores orders in'", "orders -> db 'stores orders in'\n    web -> db 'reads order counts from'"))
  assert.equal(run(dir).status, 0)
}))

test('warns about a mapped folder that does not exist', () => withSample(dir => {
  const model = join(dir, 'architecture/model.c4')
  writeFileSync(model, readFileSync(model, 'utf8').replace("code 'src/db'", "code 'src/database'"))
  const result = JSON.parse(run(dir, '--json').stdout)
  assert.deepEqual(result.missingFolders.map(c => c.id), ['shop.db'])
}))

test('warns about imported files that belong to no component', () => withSample(dir => {
  mkdirSync(join(dir, 'src/shared'), { recursive: true })
  writeFileSync(join(dir, 'src/shared/format.ts'), 'export const money = (n: number) => `$${n}`\n')
  const orders = join(dir, 'src/orders/orders.ts')
  writeFileSync(orders, "import { money } from '../shared/format'\n" + readFileSync(orders, 'utf8'))
  const result = JSON.parse(run(dir, '--json').stdout)
  assert.deepEqual(result.unmappedFiles, ['src/shared/format.ts'])
}))

test('model errors stop the check with a clear message', () => withSample(dir => {
  writeFileSync(join(dir, 'architecture/model.c4'), 'model { this is not valid }')
  const r = run(dir)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /model has errors/)
}))
