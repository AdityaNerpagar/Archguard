/**
 * Adapter: code -> list of file-to-file imports.
 * Uses only dependency-cruiser's documented API (cruise).
 * Covers JavaScript and TypeScript.
 */
import { cruise } from 'dependency-cruiser'
import type { CodeDependency } from '../model.js'

export interface ScanResult {
  files: string[]
  dependencies: CodeDependency[]
}

export async function scanImports(projectDir: string, folders: string[]): Promise<ScanResult> {
  const previousDir = process.cwd()
  process.chdir(projectDir) // dependency-cruiser reports paths relative to the working directory
  try {
    const result = await cruise(folders, {
      exclude: { path: '(^|/)(node_modules|dist|build|coverage)/' },
      doNotFollow: { path: 'node_modules' },
      tsPreCompilationDeps: true,
    })
    const output = result.output as any
    if (typeof output === 'string') throw new Error('Unexpected dependency-cruiser output format')

    const files: string[] = []
    const dependencies: CodeDependency[] = []
    for (const mod of output.modules) {
      if (mod.coreModule || mod.couldNotResolve || mod.source.includes('node_modules')) continue
      files.push(mod.source)
      for (const dep of mod.dependencies) {
        if (dep.coreModule || dep.couldNotResolve || dep.resolved.includes('node_modules')) continue
        dependencies.push({ fromFile: mod.source, toFile: dep.resolved })
      }
    }
    return { files, dependencies }
  } finally {
    process.chdir(previousDir)
  }
}
