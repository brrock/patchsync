---
name: patchsync
description: Use this skill whenever the user wants to set up, configure, manage, repair, regenerate, publish, or verify a PatchSync patch stack. Prefer the single `patchsync` CLI for local repo workflows, use the repo config/schema/README for configuration and GitHub Action management, and keep edits scoped to patch maintenance files unless the user explicitly asks to change the tooling.
---

# PatchSync Setup And Management

Use this skill for end-to-end PatchSync work in PatchSync repositories:

- bootstrapping a new PatchSync-managed repo
- configuring `patchsync.config.json`
- managing patch order and patch-stack health
- repairing or regenerating patches locally
- configuring GitHub Action publishing, agent repair, dependency install, and release behavior
- validating that the stack and workflow configuration still match the intended operating model

## When to use it

- Initialize PatchSync in a repo with `patchsync init`
- Explain or edit `patchsync.config.json`, `patchsync.schema.json`, workflow files, or `LATEST_SUPPORTED_COMMIT`
- Prepare a clean upstream scratch tree in `.patchsync-local/target`
- Update one existing patch without contaminating later patches
- Create a new patch at the end of the stack
- Re-run local verification before pushing
- Configure or review:
  - upstream target repo/ref
  - verification commands
  - dependency installation
  - ACPX agent repair settings
  - breaking-change handling
  - PR/direct-push publish behavior
  - release command and artifact collection
- Help operate an existing PatchSync repo over time, not just do one local patch edit

## Preferred interface

Prefer the single CLI for local repo operations:

- `patchsync init [root]`
- `patchsync order [config]`
- `patchsync prepare [config] [patch_name]`
- `patchsync prepare [patch_name]`
- `patchsync prepare [patch_order_number]`
- `patchsync capture <patch_name> [config]`
- `patchsync verify [config]`

If the CLI is not globally installed, use `bunx @brrock/patchsync` instead of `patchsync` directly.

For configuration and behavior questions, prefer the repo sources in this order:

1. `patchsync.config.json` in the managed repo
2. `patchsync.schema.json`
3. `README.md`
4. `packages/cli/README.md`

## Core files

Know the purpose of these files before editing:

- `patchsync.config.json`: primary repo-specific configuration
- `patchsync.schema.json`: authoritative config shape and defaults
- `LATEST_SUPPORTED_COMMIT`: latest verified upstream commit, informational output file
- `patches/**`: ordered patch stack plus patch-level verification and intent docs
- `.github/workflows/patchsync.yml`: scheduled/manual automation entrypoint
- `.patchsync-local/target`: disposable local scratch clone for patch authoring

## Setup workflow

Use this when the user wants to enable PatchSync in a repo or re-establish a broken setup:

1. Run `patchsync init .`
2. Review generated files:
   - `patchsync.config.json`
   - `LATEST_SUPPORTED_COMMIT`
   - `patches/`
   - `.github/workflows/patchsync.yml`
3. Configure `target.repo` and `target.ref`
4. Configure verification commands under `verify`
5. Decide whether dependency installation is needed in `dependencies.install`
6. Decide whether automated repair is enabled in `agent`
7. Decide publishing mode in `pullRequest`
8. Decide whether release automation is enabled in `release`
9. Run `patchsync verify`

If the task is about shaping repo behavior rather than editing a patch, spend most of the effort in config and workflow review, not in `.patchsync-local/target`.

## Configuration model

PatchSync configuration usually centers on these sections:

- `target`
  - `repo`: upstream `owner/repo`
  - `ref`: upstream branch/tag/ref, usually `main`
- `patches`
  - `dir`: patch root, usually `patches`
  - `latestSupportedCommitFile`: usually `LATEST_SUPPORTED_COMMIT`
- `verify`
  - `baseline`: command on clean upstream before patches
  - `patched`: command on fully patched tree
  - `allowSameBaselineFailure`: whether a baseline failure can still be considered non-regressive
- `dependencies.install`
  - `enabled`
  - `command`
- `agent`
  - whether ACPX repair is enabled
  - provider/model/reasoning/mode/timeouts
  - install behavior
  - breaking-change handling
  - allowed write surface via `onlyModify`
- `pullRequest`
  - repaired-stack publish behavior
  - clean-update publish behavior
  - branch prefix, PR title, labels
- `release`
  - whether release runs
  - when it runs
  - command/build command
  - artifact globs

When the user asks how to configure PatchSync, answer in terms of these sections and edit the config file directly if the intent is implementation rather than explanation.

## Standard workflow

Use this flow for local patch editing unless the user asks for something narrower:

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

## Verification model

PatchSync verification runs in this order:

1. `verify.baseline` on clean upstream, if configured
2. apply the full ordered patch stack
3. run dependency install again if `dependencies.install.enabled` is true
4. `verify.patched`
5. root `patches/verification.sh`, if present
6. each patch directory `verification.sh`, if present
7. `release.command` when release policy is active

When verification design is unclear, simplify it before adding complexity. Keep baseline checks focused on proving the upstream clone is usable, and keep patched checks focused on proving the maintained result works.

## Management workflows

Use these guidelines when the task is about operating PatchSync over time:

- For patch-stack management:
  - inspect actual apply order with `patchsync order`
  - keep patch directories zero-padded and intention-revealing
  - keep each patch scoped to one coherent change
  - update `patch.md` when patch intent changes
- For automation management:
  - review `patchsync.config.json` and `.github/workflows/patchsync.yml` together
  - confirm permissions and env secrets match the configured agent/release mode
  - choose whether clean upstream advances should direct-push, open PRs, or stay unpublished
- For repair management:
  - confirm `agent.onlyModify` matches the repo's safe write surface
  - confirm provider auth expectations such as `PATCHSYNC_CODEX_AUTH_JSON` or `PATCHSYNC_OPENCODE_AUTH_JSON`
  - use breaking-change markers/issues when automated repair should stop rather than guess
- For release management:
  - configure `release.when` to match the intended cadence
  - keep `release.command` and `dependencies.install.command` explicit and reproducible
  - configure `release.artifacts` only when artifact upload/output is needed

## Publishing behavior

Understand these defaults and knobs when managing CI behavior:

- Clean upstream advances:
  - `pullRequest.cleanUpdates: "direct"` commits `LATEST_SUPPORTED_COMMIT` directly
  - `pullRequest.cleanUpdates: "pull_request"` opens a PR
  - `pullRequest.cleanUpdates: "disabled"` publishes nothing
- Repaired patch stacks:
  - `pullRequest.enabled: true` opens a PR
  - `pullRequest.enabled: false` pushes directly

Do not treat the action input `create-pr: false` as a durable config change. It only suppresses PR creation for that run.

## Agent and breaking-change management

When working on ACPX integration:

- Prefer editing `agent.provider`, `agent.model`, `agent.reasoningEffort`, `agent.mode`, and `agent.timeoutMinutes` in config
- Use `agent.install.command` only when the provider is not covered by built-in install logic
- Keep `agent.onlyModify` narrow and deliberate
- Configure `agent.breakingChange.markerFiles` and labels if human escalation is part of the operating model
- If the user wants safer automation, bias toward issue creation and workflow failure on true breaking changes rather than aggressive auto-repair

## Guardrails

During PatchSync maintenance work:

- Keep edits in the patch maintenance surface:
  - `patches/**`
  - `LATEST_SUPPORTED_COMMIT`
  - `patchsync.config.json` or repo-specific config file
  - `.github/workflows/patchsync.yml` when the task is workflow/setup/management
- Treat `.patchsync-local/target` as disposable working state
- Do not hand-edit `.patchsync-local/target` expecting it to be committed directly
- Validate config changes against `patchsync.schema.json` and existing README behavior
- If the user asks to change the tooling itself, edit `packages/cli/**`, `packages/action/**`, or `scripts/**` deliberately. Do not conflate tool changes with patch-stack maintenance
- Do not widen `agent.onlyModify` or publish permissions casually; that is a behavior change, not a formatting tweak

## Examples

**Initialize and configure a new PatchSync repo**

1. Run `patchsync init .`
2. Edit `patchsync.config.json`:
   - set `target.repo` and `target.ref`
   - set `verify.baseline` and `verify.patched`
   - decide `dependencies.install`, `agent`, `pullRequest`, and `release`
3. Review `.github/workflows/patchsync.yml`
4. Run `patchsync verify patchsync.config.json`

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

**Change automation from direct push to PRs for clean upstream updates**

1. Edit `patchsync.config.json`
2. Set `pullRequest.cleanUpdates` to `"pull_request"`
3. Review labels/title/branch prefix
4. Verify the workflow still has the permissions needed to open PRs

**Enable managed release builds**

1. Edit `patchsync.config.json`
2. Set:
   - `release.enabled: true`
   - `release.when`
   - `release.command`
   - optional `release.artifacts`
3. If the release needs installs, configure `dependencies.install`
4. Run `patchsync verify patchsync.config.json`
