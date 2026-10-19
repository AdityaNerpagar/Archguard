/**
 * The core check. Works only on the neutral format, so it doesn't change
 * when tools are added or swapped.
 *
 * Rule: an import from component X to component Y is allowed when
 *  - X and Y are the same component, or one contains the other, or
 *  - the model has a relationship from X (or a parent of X) to Y (or a parent of Y).
 * Everything else is a violation.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ArchModel, CheckResult, CodeDependency, Component, Violation } from './model.js'

export function check(model: ArchModel, files: string[], dependencies: CodeDependency[], projectDir: string): CheckResult {
  const byId = new Map(model.components.map(c => [c.id, c]))
  const mapped = model.components.filter(c => c.codePath)

  // Longest matching folder wins, so nested components take precedence over their parents.
  const ownerOf = (file: string): Component | undefined => {
    let best: Component | undefined
    for (const c of mapped) {
      const p = c.codePath!
      if (file === p || file.startsWith(p + '/')) {
        if (!best || p.length > best.codePath!.length) best = c
      }
    }
    return best
  }

  const ancestorsOrSelf = (id: string): string[] => {
    const chain: string[] = []
    let cur: Component | undefined = byId.get(id)
    while (cur) {
      chain.push(cur.id)
      cur = cur.parent ? byId.get(cur.parent) : undefined
    }
    return chain
  }

  const allowedPairs = new Set(model.allowed.map(a => `${a.from}\u0000${a.to}`))
  const isAllowed = (from: Component, to: Component): boolean => {
    const fromChain = ancestorsOrSelf(from.id)
    const toChain = ancestorsOrSelf(to.id)
    if (fromChain.includes(to.id) || toChain.includes(from.id)) return true
    for (const f of fromChain) for (const t of toChain) if (allowedPairs.has(`${f}\u0000${t}`)) return true
    return false
  }

  const violations = new Map<string, Violation>()
  for (const dep of dependencies) {
    const from = ownerOf(dep.fromFile)
    const to = ownerOf(dep.toFile)
    if (!from || !to || isAllowed(from, to)) continue
    const key = `${from.id}\u0000${to.id}`
    if (!violations.has(key)) violations.set(key, { from, to, imports: [] })
    violations.get(key)!.imports.push(dep)
  }

  return {
    violations: [...violations.values()],
    unmappedComponents: model.components.filter(c => !c.codePath && !model.components.some(k => k.parent === c.id)),
    missingFolders: mapped.filter(c => !existsSync(join(projectDir, c.codePath!))),
    unmappedFiles: files.filter(f => !ownerOf(f)),
    filesScanned: files.length,
  }
}
