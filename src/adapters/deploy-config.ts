/**
 * Adapter: deployment configs -> network connections between services.
 *
 * Imports can't show calls over the network (HTTP, gRPC, databases, queues).
 * Deployment configs often can: this reads docker-compose files and Kubernetes
 * manifests and finds connections from
 *   - depends_on / links (compose)
 *   - connection strings in environment variables and ConfigMaps that name
 *     another service, e.g. DATABASE_URL=postgres://db:5432 or BROKERS=kafka:9092
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname, basename } from 'node:path'
import { parseAllDocuments } from 'yaml'

export interface DeployService {
  name: string
  /** Where it's defined, e.g. docker-compose.yml */
  file: string
  /** Build folder relative to the project, if the service is built from this repo */
  buildContext?: string
  /** Names other services can reach it by */
  hostnames: string[]
}

export interface NetworkConnection {
  from: string
  to: string
  /** Why we think so, e.g. "environment PAYMENTS_URL in docker-compose.yml" */
  evidence: string
}

export interface DeployScan {
  services: DeployService[]
  connections: NetworkConnection[]
  filesRead: string[]
  /** YAML files that looked like configs but couldn't be parsed (e.g. Helm templates) */
  filesSkipped: string[]
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.archguard', 'vendor', 'target', '.venv', 'venv'])
const WORKLOAD_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob', 'Pod'])

export function scanDeployConfigs(projectDir: string): DeployScan {
  const files = findYaml(projectDir)
  const services = new Map<string, DeployService>()
  const pending: { from: string; values: { key: string; value: string }[]; file: string }[] = []
  const explicit: NetworkConnection[] = []
  const configMaps = new Map<string, Record<string, string>>()
  const k8sServices: { name: string; namespace?: string; selector: Record<string, string>; file: string }[] = []
  const workloadLabels = new Map<string, Record<string, string>>()
  const workloadEnv: { name: string; file: string; env: { key: string; value?: string; configMap?: string; configMapKey?: string }[] }[] = []
  const filesRead: string[] = []
  const filesSkipped: string[] = []

  for (const file of files) {
    const rel = relative(projectDir, file).replace(/\\/g, '/')
    let docs: unknown[]
    try {
      if (statSync(file).size > 1024 * 1024) continue
      const text = readFileSync(file, 'utf8')
      if (text.includes('{{')) { // templating (Helm etc.) isn't valid YAML until rendered
        if (/^\s*(kind|services)\s*:/m.test(text)) filesSkipped.push(rel)
        continue
      }
      const parsed = parseAllDocuments(text)
      if (!Array.isArray(parsed)) continue
      if (parsed.some(d => d.errors.length > 0)) { filesSkipped.push(rel); continue }
      docs = parsed.map(d => d.toJS())
    } catch {
      filesSkipped.push(rel)
      continue
    }

    let used = false
    for (const doc of docs) {
      if (!isObj(doc)) continue

      // docker-compose
      if (isObj(doc.services) && /compose/i.test(basename(file))) {
        used = true
        for (const [name, svc] of Object.entries(doc.services)) {
          if (!isObj(svc)) continue
          const ctx = typeof svc.build === 'string' ? svc.build : isObj(svc.build) && typeof svc.build.context === 'string' ? svc.build.context : undefined
          const hostnames = [name]
          if (typeof svc.hostname === 'string') hostnames.push(svc.hostname)
          if (typeof svc.container_name === 'string') hostnames.push(svc.container_name)
          if (isObj(svc.networks)) {
            for (const net of Object.values(svc.networks)) {
              if (isObj(net) && Array.isArray(net.aliases)) hostnames.push(...net.aliases.filter(isStr))
            }
          }
          addService(services, {
            name, file: rel, hostnames,
            buildContext: ctx ? relative(projectDir, resolve(dirname(file), ctx)).replace(/\\/g, '/') : undefined,
          })

          const deps = Array.isArray(svc.depends_on) ? svc.depends_on : isObj(svc.depends_on) ? Object.keys(svc.depends_on) : []
          for (const d of deps.filter(isStr)) explicit.push({ from: name, to: d, evidence: `depends_on in ${rel}` })
          for (const l of (Array.isArray(svc.links) ? svc.links : []).filter(isStr)) {
            explicit.push({ from: name, to: l.split(':')[0], evidence: `links in ${rel}` })
          }
          pending.push({ from: name, values: envEntries(svc.environment), file: rel })
        }
        continue
      }

      // Kubernetes
      if (typeof doc.kind === 'string' && isObj(doc.metadata) && typeof doc.metadata.name === 'string') {
        used = true
        const name = doc.metadata.name
        const ns = typeof doc.metadata.namespace === 'string' ? doc.metadata.namespace : undefined
        if (doc.kind === 'ConfigMap') {
          const data: Record<string, string> = {}
          for (const [k, v] of Object.entries(isObj(doc.data) ? doc.data : {})) if (isStr(v)) data[k] = v
          configMaps.set(name, data)
        } else if (doc.kind === 'Service' && isObj(doc.spec)) {
          const selector = isObj(doc.spec.selector) ? doc.spec.selector as Record<string, string> : {}
          k8sServices.push({ name, namespace: ns, selector, file: rel })
        } else if (WORKLOAD_KINDS.has(doc.kind)) {
          const pod = podSpec(doc)
          addService(services, { name, file: rel, hostnames: [name] })
          workloadLabels.set(name, podLabels(doc))
          const env: { key: string; value?: string; configMap?: string; configMapKey?: string }[] = []
          for (const c of [...arr(pod?.containers), ...arr(pod?.initContainers)]) {
            for (const e of arr(c.env)) {
              if (!isStr(e.name)) continue
              if (isStr(e.value)) env.push({ key: e.name, value: e.value })
              const ref = isObj(e.valueFrom) && isObj(e.valueFrom.configMapKeyRef) ? e.valueFrom.configMapKeyRef : undefined
              if (ref && isStr(ref.name) && isStr(ref.key)) env.push({ key: e.name, configMap: ref.name, configMapKey: ref.key })
            }
            for (const ef of arr(c.envFrom)) {
              if (isObj(ef.configMapRef) && isStr(ef.configMapRef.name)) env.push({ key: '*', configMap: ef.configMapRef.name })
            }
          }
          workloadEnv.push({ name, file: rel, env })
        }
      }
    }
    if (used) filesRead.push(rel)
  }

  // Kubernetes Services give workloads extra hostnames.
  for (const s of k8sServices) {
    const keys = Object.entries(s.selector)
    if (keys.length === 0) continue
    for (const [workload, labels] of workloadLabels) {
      if (keys.every(([k, v]) => labels[k] === v)) {
        const ns = s.namespace ?? 'default'
        services.get(workload)!.hostnames.push(s.name, `${s.name}.${ns}`, `${s.name}.${ns}.svc`, `${s.name}.${ns}.svc.cluster.local`)
      }
    }
  }
  for (const w of workloadEnv) {
    const values: { key: string; value: string }[] = []
    for (const e of w.env) {
      if (e.value !== undefined) values.push({ key: e.key, value: e.value })
      else if (e.configMap && configMaps.has(e.configMap)) {
        const data = configMaps.get(e.configMap)!
        if (e.configMapKey) { if (data[e.configMapKey]) values.push({ key: e.key, value: data[e.configMapKey] }) }
        else for (const [k, v] of Object.entries(data)) values.push({ key: `${k} (ConfigMap ${e.configMap})`, value: v })
      }
    }
    pending.push({ from: w.name, values, file: w.file })
  }

  // Resolve connection strings to services.
  const byHost = new Map<string, string>()
  for (const s of services.values()) for (const h of s.hostnames) byHost.set(h.toLowerCase(), s.name)
  const connections = [...explicit]
  for (const p of pending) {
    for (const { key, value } of p.values) {
      for (const host of hostsIn(value)) {
        const target = byHost.get(host)
        if (target && target !== p.from) connections.push({ from: p.from, to: target, evidence: `environment ${key} in ${p.file}` })
      }
    }
  }

  return {
    services: [...services.values()],
    connections: connections.filter(c => services.has(c.from) && services.has(c.to)),
    filesRead,
    filesSkipped,
  }
}

/** Host names mentioned in a config value: URLs, host:port, comma-separated lists, or a bare host. */
export function hostsIn(value: string): string[] {
  const hosts = new Set<string>()
  for (const m of value.matchAll(/[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]*@)?([^:/\s,;?#]+)/gi)) hosts.add(m[1])
  for (const m of value.matchAll(/(?:^|[\s,;=@])([a-z0-9][a-z0-9.-]*):\d{2,5}\b/gi)) hosts.add(m[1])
  if (/^[a-z0-9][a-z0-9.-]*$/i.test(value.trim())) hosts.add(value.trim())
  return [...hosts].map(h => h.toLowerCase())
}

function envEntries(env: unknown): { key: string; value: string }[] {
  if (Array.isArray(env)) {
    return env.filter(isStr).map(s => {
      const i = s.indexOf('=')
      return i < 0 ? { key: s, value: '' } : { key: s.slice(0, i), value: s.slice(i + 1) }
    })
  }
  if (isObj(env)) return Object.entries(env).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => ({ key: k, value: String(v) }))
  return []
}

function podSpec(doc: Record<string, any>): Record<string, any> | undefined {
  if (doc.kind === 'Pod') return doc.spec
  if (doc.kind === 'CronJob') return doc.spec?.jobTemplate?.spec?.template?.spec
  return doc.spec?.template?.spec
}

function podLabels(doc: Record<string, any>): Record<string, string> {
  const labels = doc.kind === 'Pod' ? doc.metadata?.labels
    : doc.kind === 'CronJob' ? doc.spec?.jobTemplate?.spec?.template?.metadata?.labels
    : doc.spec?.template?.metadata?.labels
  return isObj(labels) ? labels as Record<string, string> : {}
}

function addService(map: Map<string, DeployService>, s: DeployService) {
  const existing = map.get(s.name)
  if (existing) {
    existing.hostnames.push(...s.hostnames)
    existing.buildContext ??= s.buildContext
  } else {
    map.set(s.name, s)
  }
}

function findYaml(dir: string, depth = 0, out: string[] = []): string[] {
  if (depth > 6) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !(e.name.startsWith('.') && e.name !== '.k8s')) findYaml(join(dir, e.name), depth + 1, out)
    } else if (/\.ya?ml$/i.test(e.name)) {
      out.push(join(dir, e.name))
    }
  }
  return out
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const arr = (v: unknown): Record<string, any>[] => (Array.isArray(v) ? v.filter(isObj) : [])
