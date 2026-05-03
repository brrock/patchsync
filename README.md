# PatchSync
<img width="1536" height="1024" alt="patchsync-img" src="https://github.com/user-attachments/assets/bc4b2ff5-fb51-40d3-bbad-d168b80f3b05" />

PatchSync is a GitHub Action for maintaining patch stacks against an upstream repository.

It deterministically clones upstream, applies ordered patch directories, runs verification, and records the latest verified upstream commit in `LATEST_SUPPORTED_COMMIT`. If the stack no longer applies or fails verification, PatchSync can delegate repair to an ACPX coding agent configured in `patchsync.config.json`, regenerate patch files, verify from a clean clone, and open a pull request.

`LATEST_SUPPORTED_COMMIT` is informational only. PatchSync never reads it as workflow state.

It can also run release commands from the patched upstream worktree and expose any configured artifact paths as action outputs.

## Quick Start

Install the local CLI from npm:

```bash
bun add -g @brrock/patchsync
```

Or from a clone of this repo:

```bash
bun install
bun run build:cli
```

Initialize a repo:

```bash
patchsync init .
```

This creates:

- `patchsync.config.json`
- `LATEST_SUPPORTED_COMMIT`
- the initial `patches/` layout
- `.github/workflows/patchsync.yml` if it does not already exist

Set `PATCHSYNC_ACTION_REF` when running the CLI to change the generated `uses:` target.

## Patch Layout

```text
patches/
  verification.sh
  patch.md
  01-base-port/
    patch.md
    verification.sh
    0001-change.patch
  02-fix-build/
    patch.md
    0001-fix.patch
```

Patch directories are applied in lexicographic order. Root `patches/*.patch` files are supported, but the preferred format is one directory per patch.

Use numeric prefixes in patch directory names so the apply order is obvious at a glance:

```text
patches/
  01-base-port/
  02-fix-build/
  03-add-feature-flag/
```

PatchSync applies:

1. root `patches/*.patch` files, sorted lexicographically
2. patch directories, sorted lexicographically
3. patch files within each directory, sorted lexicographically

Those entries are applied cumulatively on top of each other:

1. start from clean upstream
2. apply entry 1
3. apply entry 2 on top of the result of entry 1
4. apply entry 3 on top of the result of entry 2
5. continue until the stack is complete

Show the exact order the CLI will apply with:

```bash
patchsync order patchsync.config.json
```

`patchsync order` determines this dynamically by scanning the current `patches/` directory and sorting what it finds.

## Local Workflow

The local CLI supports:

- `patchsync init [root]`
- `patchsync order [config]`
- `patchsync prepare [config] [patch_name]`
- `patchsync prepare [patch_name]`
- `patchsync prepare [patch_order_number]`
- `patchsync capture <patch_name> [config]`
- `patchsync verify [config]`

Typical flow for updating one patch:

1. `patchsync order patchsync.config.json`
2. `patchsync prepare 02-fix-build`
3. edit files under `.patchsync-local/target`
4. `patchsync capture 02-fix-build patchsync.config.json`
5. `patchsync verify patchsync.config.json`

Typical flow for creating a new patch at the end of the stack:

1. `patchsync order patchsync.config.json`
2. choose the next numeric prefix, for example `03-add-feature-flag`
3. `patchsync prepare`
4. edit files under `.patchsync-local/target`
5. `patchsync capture 03-add-feature-flag patchsync.config.json`
6. update `patches/03-add-feature-flag/patch.md`
7. `patchsync verify patchsync.config.json`

When updating an existing patch, `prepare` stops before that patch and applies every earlier patch in lexicographic order. For example:

```bash
patchsync prepare 02-fix-build
patchsync prepare 2
```

That prepares upstream plus `01-*` patches, but not `02-fix-build` or anything after it. This keeps the captured diff scoped to the target patch.

## Verification Order

Verification runs in this order:

1. `verify.baseline` on clean upstream
2. apply every patch file
3. install dependencies again if `dependencies.install.enabled` is true
4. `verify.patched`
5. root `patches/verification.sh`, if present
6. each patch directory `verification.sh`, if present
7. run `release.command` if release policy is active

## GitHub Action

```yaml
name: PatchSync

on:
  schedule:
    - cron: "17 3 * * *"
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  patchsync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: brrock/patchsync@v1
        id: patchsync
        with:
          config: patchsync.config.json
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          PATCHSYNC_CODEX_AUTH_JSON: ${{ secrets.PATCHSYNC_CODEX_AUTH_JSON }}
          PATCHSYNC_OPENCODE_AUTH_JSON: ${{ secrets.PATCHSYNC_OPENCODE_AUTH_JSON }}

      - uses: actions/upload-artifact@v4
        if: steps.patchsync.outputs.release-built == 'true'
        with:
          name: patchsync-artifacts
          path: ${{ steps.patchsync.outputs.artifact-paths }}
```

## Publishing Behavior

By default, clean upstream advances publish `LATEST_SUPPORTED_COMMIT` directly to the repository default branch, while repaired patch stacks open a PR.

Publishing modes:

- `pullRequest.cleanUpdates: "direct"`: clean upstream advances publish `LATEST_SUPPORTED_COMMIT` with a direct commit
- `pullRequest.cleanUpdates: "pull_request"`: clean upstream advances open a PR
- `pullRequest.cleanUpdates: "disabled"`: clean upstream advances are not published
- `pullRequest.enabled: true`: repaired patch stacks push a branch and open a PR
- `pullRequest.enabled: false`: repaired patch stacks commit and push directly to the repository default branch

The action input `create-pr: false` only suppresses PR creation for that run. It does not change the configured publish mode to a direct push.

## Agent Repair

Configure the ACPX adapter and model in `patchsync.config.json`:

```json
{
  "agent": {
    "provider": "codex",
    "model": "gpt-5.4",
    "reasoningEffort": "high",
    "mode": "session",
    "install": {
      "enabled": true
    }
  }
}
```

PatchSync has built-in install commands for these providers: `codex`, `claude`, `copilot`, `droid`, `cursor`, `gemini`, `iflow`, `kilocode`, `kimi`, `kiro`, `opencode`, `qoder`, and `qwen`.

For custom providers, set `agent.install.command`.

PatchSync invokes ACPX with `--approve-all --non-interactive-permissions fail` so repair turns can edit files and run verification on GitHub runners. `agent.model` maps to ACPX `--model`. For Codex, `agent.reasoningEffort` maps to `acpx codex set thought_level <value>` when `agent.mode` is `session`.

During repair, PatchSync runs ACPX with JSON output enabled and emits parsed event summaries directly to the GitHub Action log and job summary.

For file-based agent auth on GitHub runners:

- Set `PATCHSYNC_CODEX_AUTH_JSON` to the full contents of `~/.codex/auth.json`
- Set `PATCHSYNC_OPENCODE_AUTH_JSON` to the full contents of `~/.local/share/opencode/auth.json`

PatchSync will write those files on the runner before agent install and before ACPX runs.

## Breaking Changes

If the agent determines that upstream changed too much for a safe automated repair, it should create `BREAKING_CHANGE.md` in the target worktree. PatchSync detects configured marker files and creates an issue instead of opening a repair PR.

```json
{
  "agent": {
    "breakingChange": {
      "enabled": true,
      "createIssue": true,
      "failWorkflow": true,
      "markerFiles": ["BREAKING_CHANGE.md"],
      "labels": ["patchsync", "breaking-change"]
    }
  }
}
```

## Dependencies

If you want PatchSync to install dependencies in the cloned upstream repo before verification and builds, configure:

```json
{
  "dependencies": {
    "install": {
      "enabled": true,
      "command": "bun install --frozen-lockfile"
    }
  }
}
```

When this is enabled, PatchSync runs the install command before baseline verification and again after patches are applied.

## Releases

PatchSync can run a release command from the patched upstream tree. That command can build artifacts, publish to npm, or do both.

```json
{
  "release": {
    "enabled": true,
    "when": "every_upstream_release",
    "prereleaseSource": "ignore",
    "command": "bun run build",
    "artifacts": ["dist/**", "build/**"]
  }
}
```

Artifact collection is optional. If `release.artifacts` is set, PatchSync resolves matching files and exposes them through the action outputs. If you only want to publish, omit `artifacts`:

```json
{
  "release": {
    "enabled": true,
    "when": "every_upstream_release",
    "command": "npm publish"
  }
}
```

`release.buildCommand` is still accepted as a backward-compatible alias for `release.command`.

Release policies:

- `every_upstream_nightly`: build only on scheduled workflow runs
- `every_upstream_commit`: build on every successful run against the configured upstream ref
- `every_upstream_release`: resolve the upstream ref from the latest GitHub release tag instead of `target.ref`

For `every_upstream_release`, `prereleaseSource` can be:

- `ignore`: stable releases only
- `include`: latest release, stable or prerelease
- `only`: prereleases only

## Development

Build everything:

```bash
bun run build
```

Build only the action bundle:

```bash
bun run build:action
```

Build the CLI package shims:

```bash
bun run build:cli
```

Package layout:

- `packages/action/src` -> `packages/action/dist/index.js`
- `packages/cli/src` -> `packages/cli/dist/main.js`

For CLI-only usage details, see [packages/cli/README.md](/Volumes/SSD/projects/patchsync/packages/cli/README.md).
