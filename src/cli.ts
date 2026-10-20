#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { readLikeC4 } from './adapters/likec4.js'
import { scanImports } from './adapters/dependency-cruiser.js'
import { check } from './check.js'
import { formatReport } from './report.js'
import { planInit, planToModel, renderModel, writeModel } from './init.js'
import { installSkills } from './install-skill.js'
import { formatActual, INSTALL_HINT, planAnalyses, runActual } from './actual.js'
import { readProjectName } from './init.js'
import { scanDeployConfigs } from './adapters/deploy-config.js'
import { makeRules, mapServices } from './check.js'

const USAGE = `Usage: archguard <command> [options]

Commands:
  init            Create a starter architecture model from your source folders
  check           Check that the code only uses dependencies drawn in the model
  actual          Show the architecture as the code really is (uses Emerge) and compare it with the model
  install-skill   Install the Claude Code skills: draft the model from docs, and align code with it

Common options:
  --project <dir>   Project root (default: current folder)
  --model <dir>     Folder with the .c4 files, relative to the project (default: architecture)

init options:
  --src <dir>       Folder whose subfolders become elements (default: src/, or the project root)
  --from-code       Also draw the dependencies that exist in the code today, for you to review

check options:
  --json            Print the result as JSON
  --no-network      Skip docker-compose and Kubernetes configs

actual options:
  --out <dir>       Where to write results (default: .archguard/actual)
  --per-element     Also run a separate Emerge analysis for each element

install-skill options:
  --global          Install for all your projects (~/.claude/skills) instead of this one
  --force           Replace an existing copy

  -h, --help        Show this help`

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === '-h' || command === '--help') {
    console.log(USAGE)
    return 0
  }

  const opt = (flag: string) => {
    const i = rest.indexOf(flag)
    return i >= 0 ? rest[i + 1] : undefined
  }
  const has = (flag: string) => rest.includes(flag)
  const projectDir = resolve(opt('--project') ?? '.')
  const modelArg = opt('--model') ?? 'architecture'
  const modelDir = resolve(projectDir, modelArg)

  switch (command) {
    case 'init':
      return runInit(projectDir, modelDir, modelArg, opt('--src'), has('--from-code'))
    case 'check':
      return runCheck(projectDir, modelDir, modelArg, has('--json'), !has('--no-network'))
    case 'actual':
      return runActualCommand(projectDir, modelDir, modelArg, opt('--out'), has('--per-element'))
    case 'install-skill': {
      const targets = installSkills(projectDir, has('--global'), has('--force'))
      for (const t of targets) console.log(`Installed ${t}`)
      console.log(`
In Claude Code, ask:
  "Draft the architecture model from the docs"   (draft-architecture)
  "Align the code with the architecture"         (align-architecture)`)
      return 0
    }
    default:
      console.error(`Unknown command "${command}"\n\n${USAGE}`)
      return 2
  }
}

async function runInit(projectDir: string, modelDir: string, modelArg: string, src: string | undefined, fromCode: boolean): Promise<number> {
  const plan = planInit({ projectDir, modelDir, srcDir: src })
  if (plan.folders.length === 0) {
    console.error('Found no source folders to turn into elements. Point to them with --src <dir>.')
    return 2
  }

  let found: { from: string; to: string; imports: number }[] = []
  if (fromCode) {
    const model = planToModel(plan)
    const { files, dependencies } = await scanImports(projectDir, plan.folders.map(f => f.codePath))
    const result = check(model, files, dependencies, projectDir)
    const local = (id: string) => id.slice(plan.systemId.length + 1)
    found = result.violations.map(v => ({ from: local(v.from.id), to: local(v.to.id), imports: v.imports.length }))
  }

  const file = writeModel(modelDir, renderModel(plan, found))
  // Make sure what we wrote is a valid model.
  await readLikeC4(modelDir)

  console.log(`Created ${relative(process.cwd(), file) || file} with ${plan.folders.length} elements:`)
  for (const f of plan.folders) console.log(`  ${f.title.padEnd(24)} ${f.codePath}`)
  if (fromCode) console.log(`\nAdded ${found.length} dependencies found in the code. Delete any that shouldn't exist.`)
  const flag = modelArg === 'architecture' ? '' : ` --model ${modelArg}`
  console.log(`\nNext:
  1. Edit the model: names, descriptions, and the allowed arrows.
     Or let Claude Code fill it in from your docs: archguard install-skill
  2. View it:  npx likec4 start ${modelArg}
  3. Check it: archguard check${flag}`)
  return 0
}

async function loadModel(modelDir: string, modelArg: string) {
  const hasModel = existsSync(modelDir) && readdirSync(modelDir, { recursive: true })
    .some(f => String(f).endsWith('.c4') || String(f).endsWith('.likec4'))
  if (!hasModel) {
    const flag = modelArg === 'architecture' ? '' : ` --model ${modelArg}`
    throw new Error(`No architecture model found in "${modelArg}".
Create one with:  archguard init${flag}
Or draft it from your docs in Claude Code after:  archguard install-skill`)
  }
  return readLikeC4(modelDir)
}

async function runActualCommand(projectDir: string, modelDir: string, modelArg: string, out: string | undefined, perElement: boolean): Promise<number> {
  const model = await loadModel(modelDir, modelArg)
  if (!model.components.some(c => c.codePath)) {
    console.error('No element has "code" metadata, so there is no code to analyze.')
    return 2
  }
  const opts = { projectDir, outDir: resolve(projectDir, out ?? '.archguard/actual'), perElement }
  const analyses = planAnalyses(model, opts)
  if (analyses.length === 0) {
    console.error('Found no source files Emerge can analyze in the mapped folders.')
    return 2
  }
  // Network connections from deployment configs, shown on the same diagram.
  const deploy = scanDeployConfigs(projectDir)
  const serviceMap = mapServices(model, deploy.services)
  const rules = makeRules(model)
  const network = new Map<string, { from: NonNullable<ReturnType<typeof serviceMap.get>>; to: NonNullable<ReturnType<typeof serviceMap.get>>; allowed: boolean }>()
  for (const c of deploy.connections) {
    const from = serviceMap.get(c.from), to = serviceMap.get(c.to)
    if (!from || !to || from.id === to.id) continue
    network.set(`${from.id}\u0000${to.id}`, { from, to, allowed: rules.isAllowedNetwork(from, to) })
  }
  const summary = runActual(model, analyses, opts, readProjectName(projectDir), [...network.values()])
  if ('missing' in summary) {
    console.error(`${INSTALL_HINT}\n\nThe Emerge config is ready; after installing, run: archguard actual${modelArg === 'architecture' ? '' : ` --model ${modelArg}`}`)
    return 2
  }
  await readLikeC4(summary.diagramDir) // fails loudly if the generated diagram isn't valid LikeC4
  console.log(formatActual(summary, projectDir))
  return 0
}

async function runCheck(projectDir: string, modelDir: string, modelArg: string, json: boolean, network: boolean): Promise<number> {
  const model = await loadModel(modelDir, modelArg)
  const folders = [...new Set(model.components.flatMap(c => (c.codePath ? [c.codePath] : [])))]
  const deploy = network ? scanDeployConfigs(projectDir) : undefined
  if (folders.length === 0 && !deploy?.services.length) {
    console.error('No element has "code" metadata and no deployment configs were found, so there is nothing to check. Add e.g. metadata { code \'src/orders\' } to an element.')
    return 2
  }

  // Missing folders are reported as warnings by the check, not scanned.
  const existing = folders.filter(f => existsSync(resolve(projectDir, f)))
  const { files, dependencies } = existing.length > 0
    ? await scanImports(projectDir, existing)
    : { files: [], dependencies: [] }
  const result = check(model, files, dependencies, projectDir, deploy)

  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(formatReport(result))

  return result.violations.length + result.networkViolations.length > 0 ? 1 : 0
}

main(process.argv.slice(2)).then(
  code => process.exit(code),
  err => {
    console.error(`archguard: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  },
)
