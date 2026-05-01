# PatchSync

PatchSync is a GitHub Action for maintaining patch stacks against an upstream repository.

It deterministically clones upstream, applies ordered patch directories, runs verification, and records the latest verified upstream commit in `LATEST_SUPPORTED_COMMIT`. If the stack no longer applies or fails verification, PatchSync can delegate repair to an ACPX coding agent configured in `patchsync.config.json`, regenerate patch files, verify from a clean clone, and open a pull request.

`LATEST_SUPPORTED_COMMIT` is informational only. PatchSync never reads it as workflow state.

It can also build release artifacts from the patched upstream worktree and expose artifact paths as action outputs.

Publishing behavior:

- `pullRequest.cleanUpdates: "direct"`: clean upstream advances publish `LATEST_SUPPORTED_COMMIT` with a direct commit
- `pullRequest.cleanUpdates: "pull_request"`: clean upstream advances open a PR
- `pullRequest.cleanUpdates: "disabled"`: clean upstream advances are not published
- `pullRequest.enabled: true`: repaired patch stacks push a branch and open a PR
- `pullRequest.enabled: false`: repaired patch stacks commit and push directly to the repository default branch

The action input `create-pr: false` only suppresses PR creation for that run. It does not change the configured publish mode to a direct push.

## ACPX Agents

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

PatchSync can build release artifacts from the patched upstream tree.

```json
{
  "release": {
    "enabled": true,
    "when": "every_upstream_release",
    "prereleaseSource": "ignore",
    "buildCommand": "bun run build",
    "artifacts": ["dist/**", "build/**"]
  }
}
```

Release policies:

- `every_upstream_nightly`: build only on scheduled workflow runs
- `every_upstream_commit`: build on every successful run against the configured upstream ref
- `every_upstream_release`: resolve the upstream ref from the latest GitHub release tag instead of `target.ref`

For `every_upstream_release`, `prereleaseSource` can be:

- `ignore`: stable releases only
- `include`: latest release, stable or prerelease
- `only`: prereleases only

## Patch Directory Shape

```text
patches/
  verification.sh
  patch.md
  patch_1/
    patch.md
    verification.sh
    change.patch
  patch_2/
    patch.md
    fix.patch
```

Patch directories are applied in lexicographic order. Root `patches/*.patch` files are supported, but the preferred format is one directory per patch.

Initialize the layout with:

```bash
curl -fsSL https://raw.githubusercontent.com/brrock/patchsync/main/scripts/init-patchsync.sh | bash -s -- .
```

This also creates `.github/workflows/patchsync.yml` if it does not already exist.
Set `PATCHSYNC_ACTION_REF` when running the script to change the generated `uses:` target.

By default, clean upstream advances publish `LATEST_SUPPORTED_COMMIT` directly to the repository default branch, while repaired patch stacks open a PR. Set `pullRequest.cleanUpdates` to `pull_request` or `disabled` if you want different behavior for clean runs.

Verification runs in this order:

1. `verify.baseline` on clean upstream
2. apply every patch file
3. install dependencies again if `dependencies.install.enabled` is true
4. `verify.patched`
5. root `patches/verification.sh`, if present
6. each patch directory `verification.sh`, if present
7. run `release.buildCommand` if release policy is active

## Local Patch Maintenance

Install the local maintenance skill from this repo with:

```bash
bunx skills add brrock/patchsync
```

Fetch the helper scripts directly if you want them without cloning first:

```bash
curl -fsSL https://raw.githubusercontent.com/brrock/patchsync/main/scripts/patchsync-local-prepare.sh -o patchsync-local-prepare.sh
curl -fsSL https://raw.githubusercontent.com/brrock/patchsync/main/scripts/patchsync-local-capture.sh -o patchsync-local-capture.sh
curl -fsSL https://raw.githubusercontent.com/brrock/patchsync/main/scripts/patchsync-local-verify.sh -o patchsync-local-verify.sh
chmod +x patchsync-local-prepare.sh patchsync-local-capture.sh patchsync-local-verify.sh
```

For local patch authoring and repair work:

- `scripts/patchsync-local-prepare.sh [config] [patch_name]`
- `scripts/patchsync-local-capture.sh <patch_name> [config]`
- `scripts/patchsync-local-verify.sh [config]`

Typical flow for updating one patch:

1. `scripts/patchsync-local-prepare.sh patchsync.config.json patch_2`
2. edit files under `.patchsync-local/target`
3. `scripts/patchsync-local-capture.sh patch_2 patchsync.config.json`
4. `scripts/patchsync-local-verify.sh patchsync.config.json`

## Workflow

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
