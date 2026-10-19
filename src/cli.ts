#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { readLikeC4 } from './adapters/likec4.js'
import { scanImports } from './adapters/dependency-cruiser.js'
import { check } from './check.js'
import { formatReport } from './report.js'

const USAGE = `Usage: archguard check [options]

Checks that the code only uses dependencies drawn in the LikeC4 architecture model.

Options:
  --project <dir>   Project root (default: current folder)
  --model <dir>     Folder with the .c4 files (default: <project>/architecture)
  --json            Print the result as JSON
  -h, --help        Show this help`

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === '-h' || command === '--help') {
    console.log(USAGE)
    return 0
  }
  if (command !== 'check') {
    console.error(`Unknown command "${command}"\n\n${USAGE}`)
    return 2
  }

  const opt = (flag: string) => {
    const i = rest.indexOf(flag)
    return i >= 0 ? rest[i + 1] : undefined
  }
  const projectDir = resolve(opt('--project') ?? '.')
  const modelDir = resolve(projectDir, opt('--model') ?? 'architecture')

  const model = await readLikeC4(modelDir)
  const folders = [...new Set(model.components.flatMap(c => (c.codePath ? [c.codePath] : [])))]
  if (folders.length === 0) {
    console.error('No component has "code" metadata, so there is nothing to check. Add e.g. metadata { code \'src/orders\' } to an element.')
    return 2
  }

  // Missing folders are reported as warnings by the check, not scanned.
  const existing = folders.filter(f => existsSync(resolve(projectDir, f)))
  const { files, dependencies } = existing.length > 0
    ? await scanImports(projectDir, existing)
    : { files: [], dependencies: [] }
  const result = check(model, files, dependencies, projectDir)

  if (rest.includes('--json')) console.log(JSON.stringify(result, null, 2))
  else console.log(formatReport(result))

  return result.violations.length > 0 ? 1 : 0
}

main(process.argv.slice(2)).then(
  code => process.exit(code),
  err => {
    console.error(`archguard: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  },
)
