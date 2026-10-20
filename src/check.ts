/**
 * The core check. Works only on the neutral format, so it doesn't change
 * when tools are added or swapped.
 *
 * Imports: an import from component X to component Y is allowed when
 *  - X and Y are the same component, or one contains the other, or
 *  - the model has a relationship from X (or a parent of X) to Y (or a parent of Y).
 *
 * Network connections: a service runs a whole component, and the config can't tell
 * which part inside it makes the call. So a connection from X to Y is allowed when
 * the model has a relationship from X, a parent of X, or anything inside X, to Y,
 * a parent of Y, or anything inside Y.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ArchModel, CheckResult, CodeDependency, Component, NetworkViolation, Violation } from './model.js'
import type { DeployScan, DeployService } from './adapters/deploy-config.js'

/** Returns a function that finds the component a file belongs to. Longest matching folder wins. */
export function makeOwnerOf(model: ArchModel): (file: string) => Component | undefined {
  const mapped = model.components.filter(c => c.codePath)
  return (file: string) => {
    let best: Component | undefined
    for (const c of mapped) {
      const p = c.codePath!
      if (file === p || file.startsWith(p + '/')) {
        if (!best || p.length > best.codePath!.length) best = c
      }
    }
    return best
  }
}

export function makeRules(model: ArchModel) {
  const byId = new Map(model.components.map(c => [c.id, c]))
  const ancestorsOrSelf = (id: string): string[] => {
    const chain: string[] = []
    let cur = byId.get(id)
    while (cur) {
      chain.push(cur.id)
      cur = cur.parent ? byId.get(cur.parent) : undefined
    }
    return chain
  }
  const descendantsOrSelf = (id: string): string[] => [id, ...model.components.filter(c => c.parent === id).flatMap(c => descendantsOrSelf(c.id))]
  const allowedPairs = new Set(model.allowed.map(a => `${a.from}\u0000${a.to}`))
  const anyAllowed = (froms: string[], tos: string[]) => froms.some(f => tos.some(t => allowedPairs.has(`${f}\u0000${t}`)))
  const nested = (a: string, b: string) => ancestorsOrSelf(a).includes(b) || ancestorsOrSelf(b).includes(a)

  return {
    ancestorsOrSelf,
    isAllowed(from: Component, to: Component): boolean {
      return nested(from.id, to.id) || anyAllowed(ancestorsOrSelf(from.id), ancestorsOrSelf(to.id))
    },
    isAllowedNetwork(from: Component, to: Component): boolean {
      return nested(from.id, to.id) || anyAllowed(
        [...ancestorsOrSelf(from.id), ...descendantsOrSelf(from.id)],
        [...ancestorsOrSelf(to.id), ...descendantsOrSelf(to.id)],
      )
    },
  }
}

/** Match deployed services to elements: "service" metadata, then build folder, then name. */
export function mapServices(model: ArchModel, services: DeployService[]): Map<string, Component> {
  const ownerOf = makeOwnerOf(model)
  const { ancestorsOrSelf } = makeRules(model)
  const byId = new Map(model.components.map(c => [c.id, c]))
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const result = new Map<string, Component>()

  for (const svc of services) {
    const names = new Set([svc.name, ...svc.hostnames].map(n => n.toLowerCase()))
    let el = model.components.find(c => c.services?.some(s => names.has(s.toLowerCase())))

    if (!el && svc.buildContext !== undefined) {
      const ctx = svc.buildContext === '' ? '.' : svc.buildContext
      el = ctx === '.' ? undefined : ownerOf(ctx)
      if (!el) {
        // The build folder contains several elements: use the element that contains all of them.
        const inside = model.components.filter(c => c.codePath && (ctx === '.' || c.codePath === ctx || c.codePath.startsWith(ctx + '/')))
        if (inside.length > 0) {
          const common = ancestorsOrSelf(inside[0].id).find(a => inside.every(c => ancestorsOrSelf(c.id).includes(a)))
          el = common ? byId.get(common) : undefined
        }
      }
    }

    if (!el) {
      const n = norm(svc.name)
      el = model.components.find(c => norm(c.id.split('.').pop()!) === n || norm(c.title) === n)
    }
    if (el) result.set(svc.name, el)
  }
  return result
}

export function check(
  model: ArchModel,
  files: string[],
  dependencies: CodeDependency[],
  projectDir: string,
  deploy?: DeployScan,
): CheckResult {
  const mapped = model.components.filter(c => c.codePath)
  const ownerOf = makeOwnerOf(model)
  const rules = makeRules(model)

  const violations = new Map<string, Violation>()
  for (const dep of dependencies) {
    const from = ownerOf(dep.fromFile)
    const to = ownerOf(dep.toFile)
    if (!from || !to || rules.isAllowed(from, to)) continue
    const key = `${from.id}\u0000${to.id}`
    if (!violations.has(key)) violations.set(key, { from, to, imports: [] })
    violations.get(key)!.imports.push(dep)
  }

  const networkViolations = new Map<string, NetworkViolation>()
  const serviceMap = deploy ? mapServices(model, deploy.services) : new Map<string, Component>()
  for (const c of deploy?.connections ?? []) {
    const from = serviceMap.get(c.from)
    const to = serviceMap.get(c.to)
    if (!from || !to || rules.isAllowedNetwork(from, to)) continue
    const key = `${from.id}\u0000${to.id}`
    if (!networkViolations.has(key)) networkViolations.set(key, { from, to, connections: [] })
    const list = networkViolations.get(key)!.connections
    if (!list.some(x => x.evidence === c.evidence && x.fromService === c.from && x.toService === c.to)) {
      list.push({ fromService: c.from, toService: c.to, evidence: c.evidence })
    }
  }

  const hasChildren = (c: Component) => model.components.some(k => k.parent === c.id)
  const mappedToService = new Set([...serviceMap.values()].map(c => c.id))

  return {
    violations: [...violations.values()],
    networkViolations: [...networkViolations.values()],
    unmappedComponents: model.components.filter(c => !c.codePath && !hasChildren(c) && !c.services?.length && !mappedToService.has(c.id)),
    missingFolders: mapped.filter(c => !existsSync(join(projectDir, c.codePath!))),
    unmappedFiles: files.filter(f => !ownerOf(f)),
    unmappedServices: (deploy?.services ?? []).filter(s => !serviceMap.has(s.name)).map(s => ({ name: s.name, file: s.file })),
    serviceMapping: Object.fromEntries([...serviceMap].map(([s, c]) => [s, c.id])),
    deployFiles: deploy?.filesRead ?? [],
    filesScanned: files.length,
  }
}
