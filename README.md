# ArchGuard

Keeps your code and your architecture diagram in agreement. The diagram is a
[LikeC4](https://likec4.dev) model: every arrow in it is an allowed dependency, and
anything not drawn is a violation, whether it's an import between code folders or a
network call between services.

```
$ archguard check
✗ 2 dependencies are not in the architecture (3 files and 1 deployment config checked):

  Web app (shop.web) → Database access (shop.db)   1 import
      src/web/page.ts imports src/db/store.ts

  Shop (shop) → Analytics (analytics)   network
      service shop → analytics: environment ANALYTICS_URL in docker-compose.yml

Fix the code, or if the design really changed, add the relationship to the model and get it approved.
```

Status: early, for personal use. Import checks cover JavaScript and TypeScript; the
Emerge view and network checks work for any language.

## The loop

```
docs ──draft-architecture──► model ◄──── you review and approve
                               │
            archguard check ◄──┤──► archguard actual (Emerge + configs)
                               │
                 violations ──align-architecture──► you decide each one:
                                                    fix the code, or change the model
```

| Step | How |
| --- | --- |
| Start a model from folders | `archguard init` |
| Draft it from documentation | Claude Code skill `draft-architecture` |
| Review and approve | `npx likec4 start architecture`, edit the `.c4` files |
| Check imports and network calls | `archguard check` |
| See the architecture as it really is | `archguard actual` |
| Resolve violations, human decides | Claude Code skill `align-architecture` |

## Set up

Requires Node.js 20 or newer.

```
npm install
npm run build
npm link        # makes the `archguard` command available everywhere
```

`npm link` points at this folder, so after you change the code, `npm run build`
is all you need.

Optional, for `archguard actual`: [Emerge](https://github.com/glato/emerge), a free
local Python tool.

```
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install emerge-viz --python 3.11 --with 'setuptools<81' --with pip
```

(or `pipx install emerge-viz && pipx inject emerge-viz 'setuptools<81' pip`). The
extra packages fix Emerge's compatibility with current Python tooling.

Optional, for the Claude Code skills: `archguard install-skill` in your project
(`--global` for all projects).

## 1. Get a model

All commands use `architecture/` unless you pass `--model <folder>`.

- **From your folders:** `archguard init` creates a starter model with one element per
  folder in `src/` (or the project root), already mapped to its code. Add
  `--from-code` to also draw the dependencies that exist today, so the check starts
  green and you delete the arrows that shouldn't exist. It never overwrites a model.
- **From your docs:** in Claude Code, ask *"Draft the architecture model from the docs"*.
  The `draft-architecture` skill reads only documentation, asks you to confirm the
  subsystems and the folder mapping, cites its sources, lists gaps in `GAPS.md`, and
  validates the result.
- **Both:** run `init` first; the skill then fills in names, descriptions and arrows from
  the docs while keeping the folder mapping.
- **By hand:** copy `sample/architecture/model.c4` and edit it.

What an element needs:

```
orders = container 'Orders' {
  metadata {
    code 'src/orders'        // folder with its code: checked for imports
    service 'orders-api'     // docker-compose / Kubernetes name: checked for network calls
  }
}
web -> orders 'places orders through'   // an allowed dependency
```

Both entries are optional. Services are also matched without `service` metadata when
their build folder is an element's `code` folder, or their name matches the element's.

## 2. Review it

`npx likec4 start architecture` shows the diagrams. Fix names, descriptions and arrows
in the `.c4` files. When the team agrees, change `status 'draft'` to `'approved'`.

## 3. Check

`archguard check` is the fast, pass/fail gate: no Emerge, nothing written to disk, just
an exit code. It checks two things directly against the model:

- **Imports** between code folders (JavaScript/TypeScript, via dependency-cruiser). This
  is how in-process access shows up, including a service reading its own database
  through an ORM or driver import — it's a file-to-file import like any other, checked
  against the `code` folders in the model.
- **Network connections** between services, which imports can't show — the case where
  one service calls another (or a database) *over the wire*, as a separate deployed
  process. It reads `docker-compose*.yml` / `compose*.yml` and Kubernetes manifests
  anywhere in the project, and finds connections from `depends_on`, `links`, and
  connection strings in environment variables and ConfigMaps that name another service
  (`postgres://db:5432`, `http://payments:8080`, `kafka:9092`, Kubernetes Service names).
  Helm templates are skipped, since they aren't valid YAML until rendered. `--no-network`
  turns this off.

So "the database" isn't a special case: if it's imported as code, it's an import
violation; if it's a separate container/pod your service talks to on the network, it's a
network violation, found the same way any other service-to-service call is.

Exit codes: `0` everything matches, `1` violations found, `2` the check couldn't run.

## 4. See the architecture as it really is

While `check` only tells you pass/fail, `archguard actual` is the exploratory,
visual counterpart: it runs Emerge on the mapped folders to build a full dependency
graph of the code (the same import relationships `check` validates, but as a diagram
you can browse), reuses the same deployment-config scan for network connections, and
translates both into your model's elements:

```
Dependencies between elements, as the code really is:
  ✗ Web app → Database access   1 import   not in model
  ✓ Web app → Orders   1 import

Network connections from deployment configs:
  ✗ Shop → Analytics   not in model
  ✓ Shop → Postgres database
```

It also reports arrows in the model the code never uses, elements whose code Emerge
splits into several clusters (maybe two things in one box), and clusters that mix
elements (maybe tight coupling). It writes:

- `.archguard/actual/likec4/`: a LikeC4 diagram of your elements with the dependencies
  that really exist; anything not in the model is red. Open it with
  `npx likec4 start .archguard/actual/likec4`.
- one interactive Emerge graph per language (file level, with clusters and hotspots).

`--per-element` adds a separate Emerge analysis for each element, useful for large
subsystems. Add `.archguard/` to your `.gitignore`.

## 5. Resolve violations

In Claude Code, ask *"Align the code with the architecture"*. The `align-architecture`
skill runs the check, investigates each violation, and asks you to choose for each one:
fix the code, change the model, or decide later. It then makes the code fixes one at a
time (re-running tests and the check after each), edits the model only where you said
so, and records every decision in `ALIGNMENT.md` next to the model.

## Commands and options

| Command | Option | Meaning |
| --- | --- | --- |
| all | `--project <dir>` | Project root (default: current folder) |
| all | `--model <dir>` | Folder with the `.c4` files, relative to the project (default: `architecture`) |
| `init` | `--src <dir>` | Folder whose subfolders become elements (default: `src/`, or the project root) |
| `init` | `--from-code` | Also draw today's dependencies, for you to review |
| `check` | `--json` | Machine-readable output, for CI or AI agents |
| `check` | `--no-network` | Skip docker-compose and Kubernetes configs |
| `actual` | `--out <dir>` | Where to write results (default: `.archguard/actual`) |
| `actual` | `--per-element` | Also analyze each element separately |
| `install-skill` | `--global` | Install to `~/.claude/skills` for all projects |
| `install-skill` | `--force` | Replace existing copies |

## How the rules work

An **import** from a file in element X to a file in element Y is allowed when X and Y
are the same element, one is nested inside the other, or the model has an arrow from X
(or a parent of X) to Y (or a parent of Y). A file belongs to the element with the
longest matching `code` folder.

A **network connection** from service X to service Y is allowed on the same terms, and
also when an element *inside* X or Y has the arrow. A service runs a whole element, and
the config can't tell which part inside it makes the call.

Warnings (not failures): elements with no `code` or `service` entry, `code` folders that
don't exist, imported files that belong to no element, and services that match no
element.

What it can't see yet: network calls whose address isn't in a deployment config (for
example, hard-coded in source or fetched at runtime), and which queue *topics* services
publish or subscribe to.

## Try it on the sample

`sample/` is a tiny shop with two deliberate violations: the web app reads the database
directly, and the shop calls an analytics service that isn't in the model.

```
cd sample
archguard check
archguard actual                              # needs Emerge
npx likec4 start architecture                 # the approved model
npx likec4 start .archguard/actual/likec4     # the code as it really is
```

## How it's built

ArchGuard never touches the code of the tools it uses. It installs them as
dependencies (or calls their CLI) and uses their documented interfaces. Each tool has
one small adapter that translates to and from a neutral format, so the core check
doesn't depend on any tool:

```
src/
  model.ts                       neutral format (elements, allowed deps, results)
  adapters/likec4.ts             LikeC4 model -> neutral format
  adapters/dependency-cruiser.ts JS/TS imports -> neutral format
  adapters/deploy-config.ts      docker-compose / Kubernetes -> network connections
  adapters/emerge.ts             Emerge config, run, and results
  check.ts                       the rules, on the neutral format only
  actual.ts                      `archguard actual`: Emerge results on the model
  report.ts                      human-readable check output
  init.ts                        `archguard init`: starter model from folders
  install-skill.ts               copies the bundled Claude Code skills
  cli.ts                         command line
skills/
  draft-architecture/            Claude Code skill: docs -> model
  align-architecture/            Claude Code skill: violations -> decisions -> fixes
test/cli.test.mjs                end-to-end tests on copies of the sample
```

To check imports in another language, add an adapter that returns file-to-file imports
(for example, from import-linter for Python), and choose it in `cli.ts`.

## Development

```
npm run build
npm test
```

The tests run the real tools on copies of the sample. The Emerge test is skipped when
Emerge isn't installed. Tool versions are pinned in `package.json`, so an upgrade that
breaks something shows up as a failing test in the matching adapter.

## Licenses

MIT. See `THIRD-PARTY-NOTICES.md` for the tools this builds on.
