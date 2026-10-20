---
name: draft-architecture
description: Draft or update a LikeC4 architecture model from a project's documentation, for review by humans and checking with archguard. Use when asked to draft, create, or update the architecture model or diagram from the docs.
---

# Draft the architecture model from documentation

You turn a project's documentation into a simple LikeC4 architecture model. Humans
will review and correct it, and `archguard check` will later check the code against it,
so it must be accurate, simple, and easy to edit.

## Rules

- **Read documentation, not source code**: README files, `docs/`, ADRs, design docs,
  API specs (OpenAPI, AsyncAPI, protobuf), and architecture notes in config files such as
  docker-compose or Kubernetes manifests. Listing folder *names* is allowed in step 6;
  reading what's inside source files is not.
- **Don't invent anything.** Every element and arrow must come from the docs. Record where
  with a `source` metadata entry, e.g. `source 'docs/design.md#payments'`.
- **When the docs are unclear, missing, or contradict each other, don't guess.** Write it
  in `GAPS.md` instead.
- **Keep it simple.** At most about 10 elements per view. Plain-language names,
  one-sentence descriptions, short verb labels on arrows (`'sends orders to'`). Leave out
  libraries, logging and utilities unless the docs treat them as architecture.
- **Arrows mean ALLOWED dependencies.** Anything not drawn will be reported as a violation.
- **Everything stays local.** No uploads, no online services.

## Steps

1. **Find the model folder.** Use the folder the user named. Otherwise use `architecture/`.
   If it already contains `.c4` files (for example from `archguard init`), you are
   *updating* that model: keep existing ids, `code` entries and anything marked approved,
   and add to it rather than rewriting it.

2. **List the documentation** you found and summarize in one paragraph what it says about
   the system.

3. **Propose the subsystems**: name, purpose, and the doc each comes from. Show the list
   and **wait for the user to confirm** before writing files.

4. **Write the model** in the model folder:
   - `spec.c4`: a few element kinds, e.g. `person`, `system`, `container`, `component`,
     `database`, `queue`.
   - `model.c4` for a small system, or one file per subsystem for a large one.
   - `views.c4`: a top-level view of everything, one view per subsystem, and component
     views only where the docs give enough detail. Add `dynamic` views for the 3-5 most
     important flows that cross subsystems, if the docs describe them.
   - Give each subsystem `metadata { status 'draft' }`.
   - Give every element a stable id (camelCase) and a `source` entry.
   Check current syntax at https://likec4.dev/dsl/ if you are unsure.

5. **Validate**: run `npx likec4 validate <model folder>` and fix every error.

6. **Map elements to code folders.** List the project's folder names (not file contents)
   and propose a `code` entry for each element, e.g. `code 'src/payments'`. Show the
   mapping and **wait for confirmation**, then add the `code` entries. Leave out any you
   can't map confidently and say which.

7. **Write `GAPS.md`** in the model folder, one section per subsystem: missing information,
   contradictions between documents, things that look outdated, and any connection
   between subsystems that isn't described on both sides.

8. **Run the check**: `archguard check --model <model folder>` if archguard is installed
   (otherwise say so and skip). Don't change code or remove arrows to make it pass; report
   the violations as findings for the user to decide on: fix the code, or change the model.

9. **Finish with a short summary**: number of elements per level, the main gaps, the check
   result, and how to view the diagrams: `npx likec4 start <model folder>`.
