/**
 * `archguard install-skill`: copies the bundled Claude Code skills into a project
 * (.claude/skills/) or into the user's global skills (~/.claude/skills/).
 */
import { cpSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function bundledSkills(): { name: string; dir: string }[] {
  // dist/install-skill.js -> <package>/skills
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
  if (!existsSync(root)) throw new Error(`Bundled skills not found at ${root}`)
  return readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(root, d.name, 'SKILL.md')))
    .map(d => ({ name: d.name, dir: join(root, d.name) }))
}

/** Installs every bundled skill. Returns the folders written. */
export function installSkills(projectDir: string, global: boolean, force: boolean): string[] {
  const base = join(global ? homedir() : projectDir, '.claude', 'skills')
  const skills = bundledSkills()
  const existing = skills.map(s => join(base, s.name)).filter(t => existsSync(t))
  if (existing.length > 0 && !force) {
    throw new Error(`Already installed: ${existing.join(', ')}. Use --force to replace.`)
  }
  return skills.map(s => {
    const target = join(base, s.name)
    cpSync(s.dir, target, { recursive: true, force: true })
    return target
  })
}
