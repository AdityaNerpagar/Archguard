---
name: align-architecture
description: Resolve the violations archguard finds between the code and the architecture model, with the user deciding each one (fix the code or change the model). Use when asked to align, fix, or resolve architecture violations or drift.
---

# Align the code with the architecture model

`archguard check` lists every dependency in the code that the architecture model doesn't
allow: imports between code folders, and network connections found in docker-compose or
Kubernetes configs. For each one, **the user decides**: fix the code to match the model,
or change the model because the design really changed. You investigate, recommend, and
then carry out exactly what they chose.

## Rules

- **Never decide on your own.** Don't change code or the model for a violation until the
  user has picked an option for it.
- **The model is the source of truth until the user changes it.** Don't add arrows to make
  the check pass.
- **One violation at a time** when changing code, each verifiable on its own.
- **Record every decision** in `ALIGNMENT.md`, so later readers know why.
- Don't touch elements or arrows the user didn't decide on.

## Steps

1. **Run the check.** `archguard check --json` (add `--model <folder>` if the model isn't
   in `architecture/`). If it passes, say so and stop. If any subsystem in the model still
   has `status 'draft'`, tell the user: aligning code to an unapproved model may mean
   changing code to match a mistake. Ask whether to continue.

2. **Get the bigger picture (optional).** If Emerge is installed, run `archguard actual`
   too. Its "split" and "mixed" cluster findings help judge whether a violation is a
   one-off shortcut or a sign the boxes are drawn wrong.

3. **Investigate each violation.** Read only what's needed:
   - Import violations: the importing lines in each listed file, and what they use.
   - Network violations: the config entry named in the evidence, and where the code
     uses that setting.
   Then classify it:
   - **Shortcut**: the code skips a path the model provides (e.g. web reads the database
     directly although Orders offers the same data). Usually: fix the code.
   - **New need**: a real dependency the model doesn't cover yet (e.g. a new analytics
     service). Usually: change the model.
   - **Leftover**: dead code or an unused setting. Usually: remove it.
   - **Misplaced code**: the file sits in the wrong folder (it belongs to the element it
     depends on). Usually: move the file, or fix the element's `code` folder.

4. **Ask the user.** Use AskUserQuestion, up to 4 violations per call, one question each.
   In the question, state the violation in one line, your classification, and your
   recommendation with a one-sentence reason and rough size of change
   (e.g. "2 files, about 10 lines"). Offer these options, recommended one first:
   - **Fix the code**: route it through an allowed dependency, or remove it.
   - **Change the model**: add the arrow (or move/split an element).
   - **Decide later**: leave it; it stays a violation.
   If AskUserQuestion isn't available, ask in plain text and wait.

5. **Record the decisions** in `ALIGNMENT.md` in the model folder (create it if missing).
   Append one entry per violation:

   ```
   ## <date>: <From> → <To> (import | network)
   - Evidence: <files or config entries>
   - Decision: Fix the code | Change the model | Decide later
   - Reason: <the user's reason, or your recommendation they accepted>
   - Status: open | done (<commit or short description>)
   ```

6. **Carry out "Change the model" decisions.** Edit the `.c4` files: add the relationship
   with a short verb label, and a comment pointing to the ALIGNMENT.md entry. Validate with
   `npx likec4 validate <model folder>`. Tell the user the model now needs re-approval if
   their process requires it; don't change `status` yourself.

7. **Carry out "Fix the code" decisions, one violation at a time:**
   - Make the smallest change that removes the dependency, using an allowed path where one
     exists (call Orders instead of the database, read a setting through the allowed
     service, delete an unused config entry).
   - Run the project's tests if it has any, and `archguard check` again; this violation
     must be gone and no new one added. If tests fail, fix or revert before moving on.
   - If it's a git repository, ask once whether to commit each fix separately; if yes,
     commit with a message naming the violation.
   - Mark the ALIGNMENT.md entry done.

8. **Finish.** Run `archguard check` one last time and report: what was fixed in code,
   what changed in the model, what was left for later, and the final check result.
