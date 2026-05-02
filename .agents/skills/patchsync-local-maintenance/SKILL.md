---
name: patchsync-patch-workflows
description: Use this skill whenever the user wants to prepare, repair, regenerate, or verify a PatchSync patch stack locally. Prefer the repo's TypeScript CLI entrypoints first, fall back to the shell scripts when the built CLI is unavailable, and keep the work focused on patch directories plus `LATEST_SUPPORTED_COMMIT`.
---

# PatchSync Patch Workflows

Use this skill for local patch authoring and validation in PatchSync repositories.

## Goals

- Prepare a clean upstream scratch tree in `.patchsync-local/target`
- Optionally stop before a named patch directory so one patch can be edited in isolation
- Regenerate a patch directory from the current scratch-tree diff
- Re-run PatchSync locally in `check` mode before pushing

## Prefer the local CLI

Prefer these commands over ad hoc manual steps:

- `patchsync-local-prepare [config] [patch_name]`
- `patchsync-local-capture <patch_name> [config]`
- `patchsync-local-verify [config]`

Install the skill with:

- `bunx skills add brrock/path-sync`

Build them first if `packages/cli/dist` does not exist:

- `bun install`
- `bun run build:cli`

The CLI wrappers dispatch to the repo scripts. If the built CLI is unavailable or the user explicitly wants the scripts, use:

- `scripts/patchsync-local-prepare.sh [config] [patch_name]`
- `scripts/patchsync-local-capture.sh <patch_name> [config]`
- `scripts/patchsync-local-verify.sh [config]`

Use them in this order unless the user asks for something narrower:

1. Prepare the scratch tree:
   - Full stack: `patchsync-local-prepare`
   - Single patch workflow: `patchsync-local-prepare patchsync.config.json patch_2`
2. Edit files in `.patchsync-local/target`
3. Regenerate the target patch:
   - `patchsync-local-capture patch_2`
4. Verify locally:
   - `patchsync-local-verify`

## Working model

PatchSync patch directories are applied in lexicographic order.

When updating an existing patch, avoid preparing the scratch tree with that patch already applied. Prepare through the patches before it, make the intended edit in `.patchsync-local/target`, then regenerate that patch directory. That keeps the resulting diff scoped to the patch being changed.

## Expected outputs

When doing local maintenance work:

- Keep edits in the patch maintenance surface:
  - `patches/**`
  - `LATEST_SUPPORTED_COMMIT`
  - `patchsync.config.json` or repo-specific config file
- If the user asks to update the tooling itself, edit `packages/cli/**` or `scripts/**` deliberately. Do not conflate tool changes with patch-stack maintenance.
- Do not hand-edit `.patchsync-local/target` expecting it to be committed directly
- Treat `.patchsync-local/target` as disposable working state

## Examples

**Update one broken patch**

1. Run `patchsync-local-prepare patchsync.config.json patch_2`
2. Edit `.patchsync-local/target/...`
3. Run `patchsync-local-capture patch_2 patchsync.config.json`
4. Run `patchsync-local-verify patchsync.config.json`

**Create a new patch at the end of the stack**

1. Run `patchsync-local-prepare`
2. Edit `.patchsync-local/target/...`
3. Run `patchsync-local-capture patch_3 patchsync.config.json`
4. Add intent text to `patches/patch_3/patch.md`
5. Run `patchsync-local-verify patchsync.config.json`
