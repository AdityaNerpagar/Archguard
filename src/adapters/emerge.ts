/**
 * Adapter: Emerge (https://github.com/glato/emerge), the "actual architecture" view.
 * Generates Emerge's YAML config, runs its CLI if installed, and reads its JSON exports.
 * Emerge is a Python tool, so it's an optional, separately installed dependency.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

/** Emerge language name -> file extensions */
export const EMERGE_LANGUAGES: Record<string, string[]> = {
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  py: ['.py'],
  java: ['.java'],
  kotlin: ['.kt'],
  go: ['.go'],
  swift: ['.swift'],
  ruby: ['.rb'],
  groovy: ['.groovy'],
  objc: ['.m'],
  cpp: ['.cpp', '.hpp', '.cc'],
  c: ['.c', '.h'],
}

export const IGNORED_DIRS = ['node_modules', 'dist', 'build', 'coverage', '.git', '.archguard', 'vendor', '__pycache__', '.venv', 'venv', 'target']

export interface EmergeAnalysis {
  /** Safe name, also the output subfolder */
  name: string
  language: string
  /** Absolute folder to scan */
  sourceDir: string
}

export interface EmergeResult {
  analysis: EmergeAnalysis
  outDir: string
  html?: string
  metrics?: Record<string, unknown>
  /** File path (relative to the project) -> Louvain cluster number */
  clusters: Map<string, number>
  edges: { from: string; to: string }[]
}

/** Count source files per Emerge language under the given folders. */
export function detectLanguages(dirs: string[]): Map<string, number> {
  const byExt = new Map<string, string>()
  for (const [lang, exts] of Object.entries(EMERGE_LANGUAGES)) for (const e of exts) byExt.set(e, lang)
  const counts = new Map<string, number>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.includes(entry.name) && !entry.name.startsWith('.')) walk(join(dir, entry.name))
      } else {
        const lang = byExt.get(extname(entry.name))
        if (lang && !entry.name.endsWith('.d.ts')) counts.set(lang, (counts.get(lang) ?? 0) + 1)
      }
    }
  }
  for (const d of dirs) if (existsSync(d)) walk(d)
  return counts
}

export function renderConfig(projectName: string, analyses: EmergeAnalysis[], outRoot: string): string {
  const q = (s: string) => JSON.stringify(s) // JSON strings are valid YAML strings
  const lines = ['---', `project_name: ${q(projectName)}`, 'loglevel: error', 'analyses:']
  for (const a of analyses) {
    lines.push(
      `- analysis_name: ${q(a.name)}`,
      `  source_directory: ${q(a.sourceDir)}`,
      `  only_permit_languages: [${a.language}]`,
      `  only_permit_file_extensions: [${EMERGE_LANGUAGES[a.language].join(', ')}]`,
      `  ignore_directories_containing: [${IGNORED_DIRS.map(q).join(', ')}]`,
      '  file_scan: [number_of_methods, source_lines_of_code, dependency_graph, fan_in_out, louvain_modularity, tfidf]',
      '  export:',
      `  - directory: ${q(join(outRoot, a.name))}`,
      '  - json',
      '  - d3',
    )
  }
  return lines.join('\n') + '\n'
}

export function emergeAvailable(): boolean {
  return spawnSync('emerge', ['--help'], { encoding: 'utf8' }).status === 0
}

/**
 * Run Emerge with a config file. Emerge exits 0 even when an analysis fails,
 * so success is judged by whether each analysis produced its exports.
 */
export function runEmerge(configPath: string, analyses: EmergeAnalysis[], outRoot: string, projectDir: string): EmergeResult[] {
  for (const a of analyses) {
    const dir = join(outRoot, a.name)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true }) // Emerge requires the export folder to exist
  }
  const run = spawnSync('emerge', ['-c', configPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

  return analyses.map(a => {
    const outDir = join(outRoot, a.name)
    const statsFile = join(outDir, 'emerge-statistics-and-metrics.json')
    if (!existsSync(statsFile)) {
      const tail = `${run.stderr ?? ''}`.split('\n').filter(l => l.trim() && !l.includes('pkg_resources')).slice(-3).join('\n')
      throw new Error(`Emerge produced no results for "${a.name}".\n${tail}`)
    }
    const stats = JSON.parse(readFileSync(statsFile, 'utf8'))
    // Emerge prefixes paths with the scanned folder's name; turn them into project-relative paths.
    const prefix = basename(a.sourceDir) + '/'
    const base = a.sourceDir === projectDir ? '' : a.sourceDir.slice(projectDir.length + 1) + '/'
    const toProject = (p: string) => base + (p.startsWith(prefix) ? p.slice(prefix.length) : p)

    const clusters = new Map<string, number>()
    for (const [file, m] of Object.entries(stats['local-metrics'] ?? {}) as [string, Record<string, number>][]) {
      const c = m['file_result_dependency_graph_louvain-modularity-in-file']
      if (typeof c === 'number') clusters.set(toProject(file), c)
    }

    const edges: { from: string; to: string }[] = []
    const graphFile = join(outDir, 'emerge-file_result_dependency_graph-data.json')
    if (existsSync(graphFile)) {
      const g = JSON.parse(readFileSync(graphFile, 'utf8'))
      for (const e of g.edges ?? g.links ?? []) edges.push({ from: toProject(e.source), to: toProject(e.target) })
    }

    const html = join(outDir, 'html', 'emerge.html')
    return { analysis: a, outDir, html: existsSync(html) ? html : undefined, metrics: stats['overall-metrics'], clusters, edges }
  })
}

export function writeConfig(path: string, content: string) {
  writeFileSync(path, content)
}

export const INSTALL_HINT = `Emerge isn't installed. It's a free, local Python tool. Install it with one of:
  uv tool install emerge-viz --python 3.11 --with 'setuptools<81' --with pip
  pipx install emerge-viz && pipx inject emerge-viz 'setuptools<81' pip
(Emerge supports Python 3.8-3.11; the extra packages fix compatibility with newer setuptools.)`
