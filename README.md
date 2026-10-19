# ArchGuard

Checks that your code only uses the dependencies drawn in your architecture
diagram. The diagram is a [LikeC4](https://likec4.dev) model; every arrow in it
is an allowed dependency, and anything not drawn is a violation.

```
$ archguard check
✗ 1 dependency is not in the architecture:

  Web app (shop.web) → Database access (shop.db)   1 import
      src/web/page.ts imports src/db/store.ts

Fix the code, or if the design really changed, add the relationship to the model and get it approved.
```

Status: early, for personal use. JavaScript and TypeScript only for now.

## Set up

Requires Node.js 20 or newer.

```
npm install
npm run build
npm link        # makes the `archguard` command available everywhere
```

`npm link` points at this folder, so after you change the code, `npm run build`
is all you need.

## Use it on a project

1. Put your LikeC4 model in an `architecture/` folder in the project
   (or pass `--model <dir>`).
2. Give each element that has code a `code` entry with its folder:

   ```
   orders = container 'Orders' {
     metadata {
       code 'src/orders'
     }
   }
   ```

3. Draw the allowed dependencies as relationships: `web -> orders`.
4. Run `archguard check` in the project root.

Try it on the included sample, which has one deliberate violation:

```
cd sample
archguard check
```

To see the diagram: `npx likec4 start architecture`.

### Options

| Option | Meaning |
| --- | --- |
| `--project <dir>` | Project root (default: current folder) |
| `--model <dir>` | Folder with the `.c4` files (default: `<project>/architecture`) |
| `--json` | Machine-readable output, for CI or AI agents |

Exit codes: `0` code matches, `1` violations found, `2` the check couldn't run
(for example, the model has errors).

## How the rules work

An import from a file in component X to a file in component Y is allowed when:

- X and Y are the same component, or one is nested inside the other, or
- the model has a relationship from X (or a parent of X) to Y (or a parent of Y).

A file belongs to the component with the longest matching `code` folder, so
nested components take priority over their parents.

It also warns about:

- elements with no `code` entry (they aren't checked)
- `code` folders that don't exist
- imported files that belong to no component

## How it's built

ArchGuard never touches the code of the tools it uses. It installs them as
dependencies and calls their documented APIs. Each tool has one small adapter
that translates to and from a neutral format, so the core check doesn't depend
on any tool:

```
src/
  model.ts                      neutral format (components, allowed deps, results)
  adapters/likec4.ts            LikeC4 model  -> neutral format
  adapters/dependency-cruiser.ts code imports -> neutral format
  check.ts                      the rules, on the neutral format only
  report.ts                     human-readable output
  cli.ts                        command line
test/cli.test.mjs               end-to-end tests on copies of the sample
```

To support another language, add an adapter that returns file-to-file imports
(for example, from import-linter for Python), and choose it in `cli.ts`.

## Development

```
npm run build
npm test
```

Tool versions are pinned in `package.json`. When upgrading LikeC4 or
dependency-cruiser, run the tests: they use the real tools, so a breaking change
shows up as a failing test in the matching adapter.

## Licenses

MIT. See `THIRD-PARTY-NOTICES.md` for the tools this builds on.
