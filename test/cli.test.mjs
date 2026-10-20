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

test('reports the deliberate import violation and fails', () => withSample(dir => {
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
  const r = run(dir, '--no-network')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /matches the architecture/)
}))

test('passes once the relationship is added to the model', () => withSample(dir => {
  const model = join(dir, 'architecture/model.c4')
  writeFileSync(model, readFileSync(model, 'utf8')
    .replace("orders -> db 'stores orders in'", "orders -> db 'stores orders in'\n    web -> db 'reads order counts from'"))
  assert.equal(run(dir, '--no-network').status, 0)
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

const runCmd = (dir, ...args) => spawnSync('node', [cli, ...args], { cwd: dir, encoding: 'utf8' })

test('check explains how to create a model when there is none', () => withSample(dir => {
  const r = run(dir, '--model', 'design')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /archguard init --model design/)
}))

test('init creates a valid model in a custom folder; every import is flagged until arrows are drawn', () => withSample(dir => {
  const r = runCmd(dir, 'init', '--model', 'design')
  assert.equal(r.status, 0, r.stderr)
  const model = readFileSync(join(dir, 'design/model.c4'), 'utf8')
  for (const f of ['src/web', 'src/orders', 'src/db']) assert.match(model, new RegExp(`code '${f}'`))
  const result = JSON.parse(run(dir, '--model', 'design', '--json').stdout)
  assert.equal(result.violations.length, 3)
}))

test('init --from-code draws today\'s dependencies, so the check starts green', () => withSample(dir => {
  assert.equal(runCmd(dir, 'init', '--model', 'design', '--from-code').status, 0)
  assert.equal(run(dir, '--model', 'design').status, 0)
}))

test('init never overwrites an existing model', () => withSample(dir => {
  const r = runCmd(dir, 'init')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /already contains a model/)
}))

test('init handles folder names that are LikeC4 keywords or odd characters', () => withSample(dir => {
  for (const name of ['model', 'views', '2fa-service', 'user_profile']) mkdirSync(join(dir, 'src', name))
  assert.equal(runCmd(dir, 'init', '--model', 'design').status, 0)
  assert.equal(run(dir, '--model', 'design', '--json').status, 1) // valid model, the 3 sample imports flagged
}))

test('install-skill copies both skills into the project', () => withSample(dir => {
  assert.equal(runCmd(dir, 'install-skill').status, 0)
  for (const name of ['draft-architecture', 'align-architecture']) {
    const skill = readFileSync(join(dir, `.claude/skills/${name}/SKILL.md`), 'utf8')
    assert.match(skill, new RegExp(`^---\\nname: ${name}\\n`))
  }
  assert.equal(runCmd(dir, 'install-skill').status, 2) // refuses to overwrite without --force
  assert.equal(runCmd(dir, 'install-skill', '--force').status, 0)
}))

// ---------- Network connections from deployment configs ----------

test('finds a network call that imports cannot see (docker-compose)', () => withSample(dir => {
  const result = JSON.parse(run(dir, '--json').stdout)
  assert.equal(result.networkViolations.length, 1)
  const v = result.networkViolations[0]
  assert.equal(v.from.id, 'shop')
  assert.equal(v.to.id, 'analytics')
  assert.match(v.connections[0].evidence, /ANALYTICS_URL in docker-compose\.yml/)
  // Connections to postgres and payments are allowed by arrows from elements inside the shop.
  assert.deepEqual(result.serviceMapping, { shop: 'shop', postgres: 'database', 'payments-mock': 'payments', analytics: 'analytics' })
}))

test('the network violation goes away once the model allows it', () => withSample(dir => {
  const model = join(dir, 'architecture/model.c4')
  writeFileSync(model, readFileSync(model, 'utf8').replace("shop.db -> database", "shop -> analytics 'sends usage events to'\n  shop.db -> database"))
  const result = JSON.parse(run(dir, '--json').stdout)
  assert.equal(result.networkViolations.length, 0)
}))

test('warns about services that match no element', () => withSample(dir => {
  const compose = join(dir, 'docker-compose.yml')
  writeFileSync(compose, readFileSync(compose, 'utf8') + '\n  cache:\n    image: redis:7\n')
  const result = JSON.parse(run(dir, '--json').stdout)
  assert.deepEqual(result.unmappedServices, [{ name: 'cache', file: 'docker-compose.yml' }])
}))

test('reads Kubernetes manifests: Services, env values and ConfigMaps', () => withSample(dir => {
  rmSync(join(dir, 'docker-compose.yml'))
  mkdirSync(join(dir, 'k8s'))
  writeFileSync(join(dir, 'k8s/app.yaml'), `
apiVersion: apps/v1
kind: Deployment
metadata: { name: shop }
spec:
  selector: { matchLabels: { app: shop } }
  template:
    metadata: { labels: { app: shop } }
    spec:
      containers:
        - name: shop
          image: shop:1
          env:
            - name: DATABASE_URL
              value: postgres://postgres-svc.prod.svc.cluster.local:5432/shop
          envFrom:
            - configMapRef: { name: shop-config }
---
apiVersion: v1
kind: ConfigMap
metadata: { name: shop-config }
data:
  EVENTS: analytics-svc:9000
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: postgres }
spec:
  template:
    metadata: { labels: { app: pg } }
    spec: { containers: [{ name: pg, image: postgres:17 }] }
---
apiVersion: v1
kind: Service
metadata: { name: postgres-svc, namespace: prod }
spec: { selector: { app: pg } }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: analytics }
spec:
  template:
    metadata: { labels: { app: analytics } }
    spec: { containers: [{ name: a, image: example/analytics:1 }] }
---
apiVersion: v1
kind: Service
metadata: { name: analytics-svc }
spec: { selector: { app: analytics } }
`)
  const result = JSON.parse(run(dir, '--json').stdout)
  assert.deepEqual(result.deployFiles, ['k8s/app.yaml'])
  assert.equal(result.networkViolations.length, 1)
  assert.equal(result.networkViolations[0].to.id, 'analytics')
  assert.match(result.networkViolations[0].connections[0].evidence, /EVENTS \(ConfigMap shop-config\)/)
}))

test('skips templated (Helm) files instead of failing', () => withSample(dir => {
  mkdirSync(join(dir, 'chart/templates'), { recursive: true })
  writeFileSync(join(dir, 'chart/templates/deploy.yaml'), 'kind: Deployment\nmetadata:\n  name: {{ .Values.name }}\n')
  assert.equal(run(dir, '--json').status, 1) // still runs; the two sample violations remain
}))

// ---------- Actual architecture (Emerge) ----------

const hasEmerge = spawnSync('emerge', ['--help']).status === 0

test('actual: maps Emerge results onto the model and writes a valid diagram', { skip: !hasEmerge && 'Emerge not installed' }, () => withSample(dir => {
  const r = runCmd(dir, 'actual')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /✗ Web app → Database access\s+1 import\s+not in model/)
  assert.match(r.stdout, /✓ Web app → Orders/)
  assert.match(r.stdout, /✗ Shop → Analytics\s+not in model/)
  const diagram = readFileSync(join(dir, '.archguard/actual/likec4/actual.c4'), 'utf8')
  assert.match(diagram, /shop\.web -> shop\.db '1 import \(not in model\)'/)
  assert.match(diagram, /shop -> analytics 'network \(not in model\)'/)
}))

test('actual: explains how to install Emerge when it is missing', () => withSample(dir => {
  const r = spawnSync('node', [cli, 'actual'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: dirname(process.execPath) } })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /uv tool install emerge-viz/)
  assert.ok(readFileSync(join(dir, '.archguard/actual/emerge.yaml'), 'utf8').includes('overview-typescript'))
}))
