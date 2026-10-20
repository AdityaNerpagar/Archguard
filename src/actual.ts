/**
 * `archguard actual`: the architecture as the code really is, from Emerge,
 * translated into the model's own elements and compared with it.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { ArchModel, Component } from './model.js'
import { makeOwnerOf } from './check.js'
import {
  detectLanguages, emergeAvailable, INSTALL_HINT, renderConfig, runEmerge, writeConfig,
  type EmergeAnalysis, type EmergeResult,
} from './adapters/emerge.js'

export interface ElementEdge {
  from: Component
  to: Component
  imports: number
  allowed: boolean
}

export interface NetworkEdge {
  from: Component
  to: Component
  allowed: boolean
}

export interface ActualSummary {
  results: EmergeResult[]
  edges: ElementEdge[]
  network: NetworkEdge[]
  /** Drawn in the model but not seen in the code */
  unused: { from: Component; to: Component }[]
  /** Elements whose files Emerge puts in several clusters */
  splitElements: { element: Component; clusters: number; files: number }[]
  /** Emerge clusters that contain files from several elements */
  mixedClusters: { cluster: number; language: string; elements: Component[] }[]
  outDir: string
  configPath: string
  diagramDir: string
}

export interface ActualOptions {
  projectDir: string
  outDir: string
  perElement: boolean
}

export function planAnalyses(model: ArchModel, opts: ActualOptions): EmergeAnalysis[] {
  const mapped = model.components.filter(c => c.codePath)
  const dirs = mapped.map(c => resolve(opts.projectDir, c.codePath!))
  const root = commonAncestor(dirs) ?? opts.projectDir
  const analyses: EmergeAnalysis[] = []
  for (const [language, n] of detectLanguages(dirs)) {
    if (n > 0) analyses.push({ name: `overview-${language}`, language, sourceDir: root })
  }
  if (opts.perElement) {
    for (const c of mapped) {
      const dir = resolve(opts.projectDir, c.codePath!)
      for (const [language, n] of detectLanguages([dir])) {
        if (n > 0) analyses.push({ name: `${c.id.replace(/[^A-Za-z0-9]+/g, '-')}-${language}`, language, sourceDir: dir })
      }
    }
  }
  return analyses
}

/** Writes the Emerge config. Returns undefined results when Emerge isn't installed. */
export function runActual(model: ArchModel, analyses: EmergeAnalysis[], opts: ActualOptions, projectName: string, network: NetworkEdge[] = []): ActualSummary | { configPath: string; missing: true } {
  mkdirSync(opts.outDir, { recursive: true })
  const configPath = join(opts.outDir, 'emerge.yaml')
  writeConfig(configPath, renderConfig(projectName, analyses, opts.outDir))
  if (!emergeAvailable()) return { configPath, missing: true }

  const results = runEmerge(configPath, analyses, opts.outDir, opts.projectDir)
  const overview = results.filter(r => r.analysis.name.startsWith('overview-'))
  const ownerOf = makeOwnerOf(model)

  // Element-level dependency graph from Emerge's file-level edges (all languages).
  const counts = new Map<string, { from: Component; to: Component; imports: number }>()
  for (const r of overview) {
    for (const e of r.edges) {
      const from = ownerOf(e.from)
      const to = ownerOf(e.to)
      if (!from || !to || from.id === to.id || isWithin(model, from, to)) continue
      const key = `${from.id}\u0000${to.id}`
      const entry = counts.get(key) ?? { from, to, imports: 0 }
      entry.imports++
      counts.set(key, entry)
    }
  }
  const allowed = new Set(model.allowed.map(a => `${a.from}\u0000${a.to}`))
  const isAllowed = (from: Component, to: Component) => {
    for (const f of chain(model, from)) for (const t of chain(model, to)) if (allowed.has(`${f.id}\u0000${t.id}`)) return true
    return false
  }
  const edges = [...counts.values()].map(e => ({ ...e, allowed: isAllowed(e.from, e.to) }))

  const byId = new Map(model.components.map(c => [c.id, c]))
  const covers = (outer: Component, inner: Component) =>
    chain(model, inner).some(x => x.id === outer.id) || chain(model, outer).some(x => x.id === inner.id)
  const seen = (a: Component, b: Component) =>
    edges.some(e => chain(model, e.from).some(x => x.id === a.id) && chain(model, e.to).some(x => x.id === b.id)) ||
    network.some(n => covers(n.from, a) && covers(n.to, b))
  const checkable = (c: Component) => Boolean(c.codePath || c.services?.length || network.some(n => n.from.id === c.id || n.to.id === c.id))
  const unused = model.allowed
    .map(a => ({ from: byId.get(a.from)!, to: byId.get(a.to)! }))
    .filter(a => a.from && a.to && checkable(a.from) && checkable(a.to) && !seen(a.from, a.to))

  // How Emerge's clusters line up with the model's elements.
  const splitElements: ActualSummary['splitElements'] = []
  const mixedClusters: ActualSummary['mixedClusters'] = []
  for (const r of overview) {
    const perElement = new Map<string, { element: Component; clusters: Set<number>; files: number }>()
    const perCluster = new Map<number, Map<string, Component>>()
    for (const [file, cluster] of r.clusters) {
      const el = ownerOf(file)
      if (!el) continue
      const pe = perElement.get(el.id) ?? { element: el, clusters: new Set<number>(), files: 0 }
      pe.clusters.add(cluster); pe.files++
      perElement.set(el.id, pe)
      const pc = perCluster.get(cluster) ?? new Map<string, Component>()
      pc.set(el.id, el)
      perCluster.set(cluster, pc)
    }
    for (const pe of perElement.values()) {
      if (pe.clusters.size > 1) splitElements.push({ element: pe.element, clusters: pe.clusters.size, files: pe.files })
    }
    for (const [cluster, els] of perCluster) {
      if (els.size > 1) mixedClusters.push({ cluster, language: r.analysis.language, elements: [...els.values()] })
    }
  }

  const diagramDir = join(opts.outDir, 'likec4')
  mkdirSync(diagramDir, { recursive: true })
  writeFileSync(join(diagramDir, 'actual.c4'), renderActualDiagram(model, edges, unused, network))

  return { results, edges, network, unused, splitElements, mixedClusters, outDir: opts.outDir, configPath, diagramDir }
}

/** A LikeC4 diagram of the model's elements with the dependencies that really exist. */
export function renderActualDiagram(model: ArchModel, edges: ElementEdge[], unused: { from: Component; to: Component }[], network: NetworkEdge[] = []): string {
  const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  const children = (parent?: string) => model.components.filter(c => c.parent === parent)
  const local = (c: Component) => c.id.split('.').pop()!
  const out: string[] = [
    '// Generated by `archguard actual`. Do not edit: it is overwritten on every run.',
    '// Arrows show dependencies that exist in the code.',
    '//   red, dashed  = in the code but NOT in the approved model',
    '//   gray, dotted = in the model but not used by the code',
    '',
    'specification {',
    '  element part',
    '}',
    '',
    'model {',
  ]
  const emit = (c: Component, indent: string) => {
    const kids = children(c.id)
    const head = `${indent}${local(c)} = part ${q(c.title)}`
    const code = c.codePath ? `${indent}  description ${q(c.codePath)}` : ''
    if (kids.length === 0) {
      out.push(code ? `${head} {\n${code}\n${indent}}` : head)
    } else {
      out.push(`${head} {`)
      if (code) out.push(code)
      for (const k of kids) emit(k, indent + '  ')
      out.push(`${indent}}`)
    }
  }
  for (const c of children(undefined)) emit(c, '  ')
  out.push('')
  for (const e of edges) {
    const label = `${e.imports} import${e.imports === 1 ? '' : 's'}${e.allowed ? '' : ' (not in model)'}`
    const style = e.allowed
      ? ' {\n    style {\n      line solid\n    }\n  }'
      : ' {\n    style {\n      color red\n      line dashed\n    }\n  }'
    out.push(`  ${e.from.id} -> ${e.to.id} ${q(label)}${style}`)
  }
  for (const n of network) {
    const label = n.allowed ? 'network' : 'network (not in model)'
    const style = n.allowed ? ' {\n    style {\n      line solid\n    }\n  }' : ' {\n    style {\n      color red\n      line dashed\n    }\n  }'
    out.push(`  ${n.from.id} -> ${n.to.id} ${q(label)}${style}`)
  }
  for (const u of unused) {
    out.push(`  ${u.from.id} -> ${u.to.id} 'in model, unused' {\n    style {\n      color gray\n      line dotted\n    }\n  }`)
  }
  const everything = ['*', ...children(undefined).filter(c => children(c.id).length > 0).map(c => `${c.id}.**`)]
  out.push('}', '', 'views {', '  view index {', "    title 'Actual architecture'", `    include ${everything.join(', ')}`, '  }')
  for (const c of model.components.filter(c => children(c.id).length > 0)) {
    out.push(`  view ${c.id.replace(/\./g, '_')}_actual of ${c.id} {`, `    title ${q(c.title + ': actual')}`, '    include *', '  }')
  }
  out.push('}', '')
  return out.join('\n')
}

export function formatActual(s: ActualSummary, projectDir: string): string {
  const rel = (p: string) => relative(process.cwd(), p) || p
  const name = (c: Component) => c.title
  const lines: string[] = ['Actual architecture (from Emerge)', '']

  if (s.edges.length === 0) {
    lines.push('No dependencies between elements found.')
  } else {
    lines.push('Dependencies between elements, as the code really is:')
    for (const e of [...s.edges].sort((a, b) => Number(a.allowed) - Number(b.allowed) || b.imports - a.imports)) {
      lines.push(`  ${e.allowed ? '✓' : '✗'} ${name(e.from)} → ${name(e.to)}   ${e.imports} import${e.imports === 1 ? '' : 's'}${e.allowed ? '' : '   not in model'}`)
    }
  }
  if (s.network.length > 0) {
    lines.push('', 'Network connections from deployment configs:')
    for (const n of [...s.network].sort((a, b) => Number(a.allowed) - Number(b.allowed))) {
      lines.push(`  ${n.allowed ? '✓' : '✗'} ${name(n.from)} → ${name(n.to)}${n.allowed ? '' : '   not in model'}`)
    }
  }
  if (s.unused.length > 0) {
    lines.push('', 'In the model but not used by the code (maybe outdated, or not built yet):')
    for (const u of s.unused) lines.push(`  · ${name(u.from)} → ${name(u.to)}`)
  }
  if (s.splitElements.length > 0) {
    lines.push('', 'Elements whose code Emerge splits into several clusters (maybe two things in one box):')
    for (const x of s.splitElements) lines.push(`  · ${name(x.element)}: ${x.files} files in ${x.clusters} clusters`)
  }
  if (s.mixedClusters.length > 0) {
    lines.push('', 'Clusters that mix several elements (maybe tightly coupled, or one thing in two boxes):')
    for (const m of s.mixedClusters) lines.push(`  · ${m.language} cluster ${m.cluster}: ${m.elements.map(name).join(', ')}`)
  }

  lines.push('', 'Open:')
  lines.push(`  Actual vs model diagram:  npx likec4 start ${rel(s.diagramDir)}`)
  for (const r of s.results) {
    const m = r.metrics ?? {}
    const extra = m['louvain-communities-dependency-graph'] !== undefined
      ? `   (${m['louvain-communities-dependency-graph']} clusters, modularity ${m['louvain-modularity-dependency-graph']})`
      : ''
    if (r.html) lines.push(`  Emerge ${r.analysis.name}: ${rel(r.html)}${extra}`)
  }
  lines.push(`  Re-run Emerge alone:      emerge -c ${rel(s.configPath)}`)
  void projectDir
  return lines.join('\n')
}

function chain(model: ArchModel, c: Component): Component[] {
  const byId = new Map(model.components.map(x => [x.id, x]))
  const out: Component[] = []
  let cur: Component | undefined = c
  while (cur) { out.push(cur); cur = cur.parent ? byId.get(cur.parent) : undefined }
  return out
}

function isWithin(model: ArchModel, a: Component, b: Component): boolean {
  return chain(model, a).some(x => x.id === b.id) || chain(model, b).some(x => x.id === a.id)
}

function commonAncestor(dirs: string[]): string | undefined {
  if (dirs.length === 0) return undefined
  const parts = dirs.map(d => d.split(sep))
  const common: string[] = []
  for (let i = 0; ; i++) {
    const seg = parts[0][i]
    if (seg === undefined || parts.some(p => p[i] !== seg)) break
    common.push(seg)
  }
  // A single folder: scan its parent so the overview still shows its neighbours.
  const joined = common.join(sep) || sep
  return dirs.length === 1 ? resolve(joined, '..') : joined
}

export { INSTALL_HINT }
