/**
 * `archguard init`: writes a starter LikeC4 model with one element per source folder,
 * so you only have to fix names, descriptions and arrows.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import type { ArchModel, Component } from './model.js'

const IGNORED = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'target', 'vendor', 'tmp', 'temp',
  'test', 'tests', '__tests__', 'spec', 'e2e', 'docs', 'doc', 'scripts', 'public', 'assets',
  'architecture', 'bin', 'obj', 'venv', 'env',
])

// Words with a meaning in the LikeC4 language; used as ids they could confuse the parser.
const RESERVED = new Set([
  'model', 'views', 'view', 'specification', 'element', 'tag', 'relationship', 'style', 'include',
  'exclude', 'extend', 'this', 'it', 'deployment', 'global', 'dynamic', 'title', 'description',
  'technology', 'metadata', 'link', 'icon', 'color', 'shape', 'notation', 'with', 'where', 'and',
  'or', 'not', 'is', 'kind', 'parent', 'source', 'target',
])

export interface InitOptions {
  projectDir: string
  modelDir: string
  /** Folder whose subfolders become elements; auto-detected when omitted */
  srcDir?: string
}

export interface InitPlan {
  systemId: string
  systemTitle: string
  folders: { id: string; title: string; codePath: string }[]
}

/** Decide which folders become elements. */
export function planInit(opts: InitOptions): InitPlan {
  const { projectDir } = opts
  const listDirs = (dir: string) =>
    readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && !IGNORED.has(d.name.toLowerCase()))
      .map(d => join(dir, d.name))
      .sort()

  let parents: string[]
  if (opts.srcDir) {
    const dir = resolve(projectDir, opts.srcDir)
    if (!existsSync(dir)) throw new Error(`Source folder "${opts.srcDir}" doesn't exist`)
    parents = [dir]
  } else if (existsSync(join(projectDir, 'src'))) {
    parents = [join(projectDir, 'src')]
  } else {
    parents = [projectDir]
  }

  let dirs = parents.flatMap(listDirs)
  // A source folder with no subfolders becomes a single element.
  if (dirs.length === 0 && parents[0] !== projectDir) dirs = parents

  const used = new Set<string>()
  const folders = dirs.map(dir => {
    const name = basename(dir)
    return { id: uniqueId(name, used), title: toTitle(name), codePath: relative(projectDir, dir).replace(/\\/g, '/') }
  })

  const projectName = readProjectName(projectDir)
  return {
    systemId: uniqueId(projectName, new Set(folders.map(f => f.id))),
    systemTitle: toTitle(projectName),
    folders,
  }
}

/** The plan as a neutral model, so the regular check can find current dependencies. */
export function planToModel(plan: InitPlan): ArchModel {
  const components: Component[] = [
    { id: plan.systemId, title: plan.systemTitle },
    ...plan.folders.map(f => ({ id: `${plan.systemId}.${f.id}`, title: f.title, codePath: f.codePath, parent: plan.systemId })),
  ]
  return { components, allowed: [] }
}

/** Render the .c4 file. `found` holds dependencies seen in the code (element ids within the system). */
export function renderModel(plan: InitPlan, found: { from: string; to: string; imports: number }[] = []): string {
  const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  const out: string[] = []
  out.push(
    '// Starter architecture model created by `archguard init`.',
    '//',
    '// How to finish it:',
    '//   1. Rename elements and write a one-sentence description for each.',
    '//   2. Merge folders that belong together; delete ones that aren\'t architecture.',
    '//   3. Draw the ALLOWED dependencies as arrows. Anything not drawn is not allowed.',
    '//   4. Check it: `archguard check`. View it: `npx likec4 start <this folder>`.',
    '//   5. When the team agrees, change status from \'draft\' to \'approved\'.',
    '',
    'specification {',
    '  element person',
    '  element system',
    '  element container',
    '  element component',
    '}',
    '',
    'model {',
    `  ${plan.systemId} = system ${q(plan.systemTitle)} {`,
    `    description 'TODO: what this system does, in one sentence'`,
    '    metadata {',
    "      status 'draft'",
    '    }',
  )

  for (const f of plan.folders) {
    out.push(
      '',
      `    ${f.id} = container ${q(f.title)} {`,
      `      description 'TODO: what this part does'`,
      '      metadata {',
      `        code ${q(f.codePath)}`,
      '      }',
      '    }',
    )
  }

  out.push('')
  if (found.length > 0) {
    out.push(
      '    // Dependencies that exist in the code TODAY. They are not automatically right:',
      '    // delete any that shouldn\'t exist, then `archguard check` will flag that code.',
    )
    for (const d of found) {
      out.push(`    ${d.from} -> ${d.to} 'uses' // found in code: ${d.imports} import${d.imports === 1 ? '' : 's'}`)
    }
  } else {
    out.push(
      '    // TODO: draw the allowed dependencies, for example:',
      plan.folders.length >= 2
        ? `    // ${plan.folders[0].id} -> ${plan.folders[1].id} 'uses'`
        : "    // web -> api 'calls'",
    )
  }
  out.push('  }', '}', '', 'views {', '  view index {', `    title ${q(plan.systemTitle)}`, `    include ${plan.systemId}, ${plan.systemId}.*`, '  }', '}', '')
  return out.join('\n')
}

/** Write the model. Refuses to overwrite an existing model. */
export function writeModel(modelDir: string, content: string): string {
  if (existsSync(modelDir) && readdirSync(modelDir).some(f => f.endsWith('.c4') || f.endsWith('.likec4'))) {
    throw new Error(`"${modelDir}" already contains a model. Remove it or choose another folder with --model.`)
  }
  mkdirSync(modelDir, { recursive: true })
  const file = join(modelDir, 'model.c4')
  writeFileSync(file, content)
  return file
}

export function readProjectName(projectDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))
    if (typeof pkg.name === 'string' && pkg.name) return pkg.name.replace(/^@[^/]+\//, '')
  } catch { /* no package.json */ }
  return basename(projectDir) || 'system'
}

function uniqueId(name: string, used: Set<string>): string {
  let id = name
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^[^A-Za-z]+/, '')
  id = id ? id[0].toLowerCase() + id.slice(1) : 'part'
  if (RESERVED.has(id)) id = `${id}Part`
  let candidate = id
  for (let n = 2; used.has(candidate); n++) candidate = `${id}${n}`
  used.add(candidate)
  return candidate
}

function toTitle(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (words.length === 0) return name
  const s = words.join(' ').toLowerCase()
  return s[0].toUpperCase() + s.slice(1)
}
