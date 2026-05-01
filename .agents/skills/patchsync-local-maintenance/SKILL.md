---
name: patchsync-local-maintenance
description: Use this skill whenever the user wants to create, update, regenerate, test, or debug PatchSync patch stacks locally. This includes preparing a scratch upstream worktree, updating a specific `patches/patch_*` directory, regenerating `patch.patch`, or running local end-to-end PatchSync verification before pushing.
---

# PatchSync Local Maintenance

Use this skill for local patch authoring and validation in PatchSync repositories.

## Goals

- Prepare a clean upstream scratch tree in `.patchsync-local/target`
- Optionally stop before a named patch directory so one patch can be edited in isolation
- Regenerate a patch directory from the current scratch-tree diff
- Re-run PatchSync locally in `check` mode before pushing

## Use the bundled repo scripts

Prefer these scripts over ad hoc manual steps:

- `scripts/patchsync-local-prepare.sh [config] [patch_name]`
- `scripts/patchsync-local-capture.sh <patch_name> [config]`
- `scripts/patchsync-local-verify.sh [config]`

Use them in this order unless the user asks for something narrower:

1. Prepare the scratch tree:
   - Full stack: `scripts/patchsync-local-prepare.sh`
   - Single patch workflow: `scripts/patchsync-local-prepare.sh patchsync.config.json patch_2`
2. Edit files in `.patchsync-local/target`
3. Regenerate the target patch:
   - `scripts/patchsync-local-capture.sh patch_2`
4. Verify locally:
   - `scripts/patchsync-local-verify.sh`

## Working model

PatchSync patch directories are applied in lexicographic order.

When updating an existing patch, avoid preparing the scratch tree with that patch already applied. Prepare through the patches before it, make the intended edit in `.patchsync-local/target`, then regenerate that patch directory. That keeps the resulting diff scoped to the patch being changed.

## Expected outputs

When doing local maintenance work:

- Keep edits in the patch maintenance surface:
  - `patches/**`
  - `LATEST_SUPPORTED_COMMIT`
  - `patchsync.config.json` or repo-specific config file
- Do not hand-edit `.patchsync-local/target` expecting it to be committed directly
- Treat `.patchsync-local/target` as disposable working state

## Examples

**Update one broken patch**

1. Run `scripts/patchsync-local-prepare.sh patchsync.config.json patch_2`
2. Edit `.patchsync-local/target/...`
3. Run `scripts/patchsync-local-capture.sh patch_2 patchsync.config.json`
4. Run `scripts/patchsync-local-verify.sh patchsync.config.json`

**Create a new patch at the end of the stack**

1. Run `scripts/patchsync-local-prepare.sh`
2. Edit `.patchsync-local/target/...`
3. Run `scripts/patchsync-local-capture.sh patch_3 patchsync.config.json`
4. Add intent text to `patches/patch_3/patch.md`
5. Run `scripts/patchsync-local-verify.sh patchsync.config.json`
