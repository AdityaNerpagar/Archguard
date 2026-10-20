/**
 * Adapter: LikeC4 model -> neutral ArchModel.
 * Uses only LikeC4's documented API (LikeC4.fromWorkspace).
 */
import { LikeC4 } from 'likec4'
import type { ArchModel, Component } from '../model.js'

export async function readLikeC4(workspaceDir: string): Promise<ArchModel> {
  const likec4 = await LikeC4.fromWorkspace(workspaceDir, { printErrors: false })

  const errors = likec4.getErrors()
  if (errors.length > 0) {
    const details = errors.map(e => `  ${e.sourceFsPath}:${e.line} ${e.message}`).join('\n')
    throw new Error(`The architecture model has errors:\n${details}`)
  }

  const model = await likec4.computedModel()

  const components: Component[] = []
  for (const el of model.elements()) {
    const metadata = el.getMetadata() as Record<string, unknown>
    const code = metadata['code']
    const service = metadata['service']
    const services = (Array.isArray(service) ? service : typeof service === 'string' ? service.split(',') : [])
      .map(s => String(s).trim()).filter(Boolean)
    components.push({
      id: el.id,
      title: el.title,
      codePath: typeof code === 'string' && code.trim() !== '' ? normalize(code) : undefined,
      parent: el.parent?.id,
      ...(services.length > 0 ? { services } : {}),
    })
  }

  const allowed = [...model.relationships()].map(r => ({
    from: r.source.id,
    to: r.target.id,
    label: r.title ?? undefined,
  }))

  return { components, allowed }
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}
