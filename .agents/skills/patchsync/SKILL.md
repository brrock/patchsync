---
name: patchsync
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

- `patchsync order [config]`
- `patchsync prepare [config] [patch_name]`
- `patchsync prepare [patch_name]`
- `patchsync prepare [patch_order_number]`
- `patchsync capture <patch_name> [config]`
- `patchsync verify [config]`
If the cli is not globally installed please bunx @brrock/patchsync instead of patchsync directly.


## Standard workflow

Use this flow unless the user asks for something narrower:

1. Prepare the scratch tree:
   - Full stack: `patchsync prepare`
   - Inspect order first: `patchsync order patchsync.config.json`
   - Single patch workflow by name: `patchsync prepare 02-fix-build`
   - Single patch workflow by order number: `patchsync prepare 2`
2. Edit files in `.patchsync-local/target`
3. Regenerate the target patch:
   - `patchsync capture 02-fix-build`
4. Verify locally:
   - `patchsync verify`

## Working model

PatchSync patch directories are applied in lexicographic order. Root `patches/*.patch` files run first, then patch directories, then patch files inside each directory, all lexicographically sorted.

They stack cumulatively. Each later patch is applied on top of the tree produced by every earlier patch.

Prefer directory names with zero-padded numeric prefixes so humans can see the intended order immediately:

- `01-base-port`
- `02-fix-build`
- `03-add-feature-flag`

Use `patchsync order` whenever there is any doubt about the exact application order.

`patchsync order` determines the current order dynamically from the patch directory contents.

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

1. Run `patchsync order patchsync.config.json`
2. Run `patchsync prepare 02-fix-build`
3. Edit `.patchsync-local/target/...`
4. Run `patchsync capture 02-fix-build patchsync.config.json`
5. Run `patchsync verify patchsync.config.json`

**Create a new patch at the end of the stack**

1. Run `patchsync order patchsync.config.json`
2. Run `patchsync prepare`
3. Edit `.patchsync-local/target/...`
4. Run `patchsync capture 03-add-feature-flag patchsync.config.json`
5. Add intent text to `patches/03-add-feature-flag/patch.md`
6. Run `patchsync verify patchsync.config.json`
