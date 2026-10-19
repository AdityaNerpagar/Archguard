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

export interface CheckResult {
  violations: Violation[]
  /** Components with no "code" metadata */
  unmappedComponents: Component[]
  /** Components whose "code" folder doesn't exist */
  missingFolders: Component[]
  /** Source files that belong to no component */
  unmappedFiles: string[]
  filesScanned: number
}
