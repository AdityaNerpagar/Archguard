import type { CheckResult } from './model.js'

export function formatReport(result: CheckResult): string {
  const lines: string[] = []
  const name = (c: { title: string; id: string }) => `${c.title} (${c.id})`
  const total = result.violations.length + result.networkViolations.length
  const checked = `${result.filesScanned} files${result.deployFiles.length ? ` and ${result.deployFiles.length} deployment config${result.deployFiles.length === 1 ? '' : 's'}` : ''} checked`

  if (total === 0) {
    lines.push(`✓ Code matches the architecture. ${checked}.`)
  } else {
    lines.push(`✗ ${total} ${total === 1 ? 'dependency is' : 'dependencies are'} not in the architecture (${checked}):`, '')
    for (const v of result.violations) {
      const n = v.imports.length
      lines.push(`  ${name(v.from)} → ${name(v.to)}   ${n} import${n === 1 ? '' : 's'}`)
      for (const i of v.imports) lines.push(`      ${i.fromFile} imports ${i.toFile}`)
      lines.push('')
    }
    for (const v of result.networkViolations) {
      lines.push(`  ${name(v.from)} → ${name(v.to)}   network`)
      for (const c of v.connections) lines.push(`      service ${c.fromService} → ${c.toService}: ${c.evidence}`)
      lines.push('')
    }
    lines.push('Fix the code, or if the design really changed, add the relationship to the model and get it approved.')
  }

  const warnings: string[] = []
  for (const c of result.missingFolders) warnings.push(`${name(c)}: folder "${c.codePath}" doesn't exist`)
  for (const c of result.unmappedComponents) warnings.push(`${name(c)}: no "code" or "service" metadata, so it isn't checked`)
  for (const s of result.unmappedServices) {
    warnings.push(`service "${s.name}" (${s.file}) matches no element; its connections aren't checked. Add metadata { service '${s.name}' } to the element that runs it`)
  }
  if (result.unmappedFiles.length > 0) {
    const shown = result.unmappedFiles.slice(0, 10).map(f => `    ${f}`)
    const more = result.unmappedFiles.length > 10 ? [`    …and ${result.unmappedFiles.length - 10} more`] : []
    warnings.push(`${result.unmappedFiles.length} file(s) belong to no component:\n${[...shown, ...more].join('\n')}`)
  }
  if (warnings.length > 0) lines.push('', 'Warnings:', ...warnings.map(w => `  ! ${w}`))

  return lines.join('\n')
}
