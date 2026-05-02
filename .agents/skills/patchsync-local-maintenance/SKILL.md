---
name: patchsync-patch-workflows
description: Use this skill whenever the user wants to prepare, repair, regenerate, or verify a PatchSync patch stack locally. Prefer the single `patchsync` CLI, fall back to the repo shell scripts only when needed, and keep edits scoped to patch maintenance files unless the user explicitly asks to change the tooling.
---

# PatchSync Patch Workflows

Use this skill for local patch authoring and validation in PatchSync repositories.

## When to use it

- Prepare a clean upstream scratch tree in `.patchsync-local/target`
- Update one existing patch without contaminating later patches
- Create a new patch at the end of the stack
- Re-run local verification before pushing

## Preferred interface

Prefer the single CLI:

- `patchsync prepare [config] [patch_name]`
- `patchsync capture <patch_name> [config]`
- `patchsync verify [config]`

If the CLI has not been built in a repo clone:

- `bun install`
- `bun run build:cli`

If the CLI is unavailable or the user explicitly wants the script layer, use:

- `scripts/patchsync-local-prepare.sh [config] [patch_name]`
- `scripts/patchsync-local-capture.sh <patch_name> [config]`
- `scripts/patchsync-local-verify.sh [config]`

## Standard workflow

Use this flow unless the user asks for something narrower:

1. Prepare the scratch tree:
   - Full stack: `patchsync prepare`
   - Single patch workflow: `patchsync prepare patchsync.config.json patch_2`
2. Edit files in `.patchsync-local/target`
3. Regenerate the target patch:
   - `patchsync capture patch_2`
4. Verify locally:
   - `patchsync verify`

## Working model

PatchSync patch directories are applied in lexicographic order.

When updating an existing patch, do not prepare the scratch tree with that patch already applied. Prepare through the patches before it, make the intended edit in `.patchsync-local/target`, then regenerate that patch directory. That keeps the resulting diff scoped to the patch being changed.

## Guardrails

During local maintenance work:

- Keep edits in the patch maintenance surface:
  - `patches/**`
  - `LATEST_SUPPORTED_COMMIT`
  - `patchsync.config.json` or repo-specific config file
- Treat `.patchsync-local/target` as disposable working state
- Do not hand-edit `.patchsync-local/target` expecting it to be committed directly
- If the user asks to change the tooling itself, edit `packages/cli/**` or `scripts/**` deliberately. Do not conflate tool changes with patch-stack maintenance

## Examples

**Update one broken patch**

1. Run `patchsync prepare patchsync.config.json patch_2`
2. Edit `.patchsync-local/target/...`
3. Run `patchsync capture patch_2 patchsync.config.json`
4. Run `patchsync verify patchsync.config.json`

**Create a new patch at the end of the stack**

1. Run `patchsync prepare`
2. Edit `.patchsync-local/target/...`
3. Run `patchsync capture patch_3 patchsync.config.json`
4. Add intent text to `patches/patch_3/patch.md`
5. Run `patchsync verify patchsync.config.json`
