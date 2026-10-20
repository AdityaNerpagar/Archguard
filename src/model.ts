/**
 * The neutral internal format. Every adapter translates to or from this,
 * so no other part of the tool depends on LikeC4 or dependency-cruiser.
 */

export interface Component {
  /** Stable id from the architecture model, e.g. "shop.orders" */
  id: string
  title: string
  /** Folder that implements this component, relative to the project root. Undefined if not mapped yet. */
  codePath?: string
  /** Parent component id, if nested */
  parent?: string
  /** Deployed service names (docker-compose / Kubernetes) that run this component, from "service" metadata */
  services?: string[]
}

export interface AllowedDependency {
  from: string
  to: string
  label?: string
}

export interface ArchModel {
  components: Component[]
  allowed: AllowedDependency[]
}

/** One import from one file to another, as found in the code. */
export interface CodeDependency {
  fromFile: string
  toFile: string
}

export interface Violation {
  from: Component
  to: Component
  /** Every import that breaks this rule */
  imports: CodeDependency[]
}

/** A network connection between services that the model doesn't allow. */
export interface NetworkViolation {
  from: Component
  to: Component
  connections: { fromService: string; toService: string; evidence: string }[]
}

export interface CheckResult {
  violations: Violation[]
  networkViolations: NetworkViolation[]
  /** Services found in deployment configs that match no element */
  unmappedServices: { name: string; file: string }[]
  /** Service name -> element id, for the ones that matched */
  serviceMapping: Record<string, string>
  /** Deployment config files that were read */
  deployFiles: string[]
  /** Components with no "code" metadata */
  unmappedComponents: Component[]
  /** Components whose "code" folder doesn't exist */
  missingFolders: Component[]
  /** Source files that belong to no component */
  unmappedFiles: string[]
  filesScanned: number
}
