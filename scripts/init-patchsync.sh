#!/usr/bin/env bash

set -euo pipefail

root_dir="${1:-.}"
patch_dir="${root_dir}/patches"
patch_one_dir="${patch_dir}/patch_1"
config_path="${root_dir}/patchsync.config.json"
latest_supported_commit_path="${root_dir}/LATEST_SUPPORTED_COMMIT"
workflow_dir="${root_dir}/.github/workflows"
workflow_path="${workflow_dir}/patchsync.yml"
action_ref="${PATCHSYNC_ACTION_REF:-brrock/patchsync@main}"

mkdir -p "${patch_one_dir}"

if [[ ! -f "${config_path}" ]]; then
  cat > "${config_path}" <<'EOF'
{
  "$schema": "./patchsync.schema.json",
  "target": {
    "repo": "owner/upstream-repo",
    "ref": "main"
  },
  "patches": {
    "dir": "patches",
    "latestSupportedCommitFile": "LATEST_SUPPORTED_COMMIT"
  },
  "verify": {
    "baseline": "bun test",
    "patched": "bun test",
    "allowSameBaselineFailure": true
  },
  "dependencies": {
    "install": {
      "enabled": true,
      "command": "bun install --frozen-lockfile"
    }
  },
  "release": {
    "enabled": true,
    "when": "every_upstream_release",
    "prereleaseSource": "ignore",
    "buildCommand": "bun run build",
    "artifacts": ["dist/**", "build/**"]
  },
  "agent": {
    "enabled": true,
    "provider": "codex",
    "model": "gpt-5.4",
    "reasoningEffort": "high",
    "mode": "session",
    "timeoutMinutes": 30,
    "install": {
      "enabled": true
    },
    "breakingChange": {
      "enabled": true,
      "createIssue": true,
      "failWorkflow": true,
      "markerFiles": ["BREAKING_CHANGE.md"],
      "labels": ["patchsync", "breaking-change"]
    },
    "acpxVersion": "latest",
    "createIssueOnBreakingChange": true,
    "onlyModify": [
      "patches/**",
      "patchsync.config.json",
      "LATEST_SUPPORTED_COMMIT"
    ]
  },
  "pullRequest": {
    "enabled": true,
    "branchPrefix": "patchsync/",
    "title": "chore: update patch stack",
    "labels": ["patchsync", "ai-maintained"]
  }
}
EOF
fi

if [[ ! -f "${latest_supported_commit_path}" ]]; then
  printf '\n' > "${latest_supported_commit_path}"
fi

if [[ ! -f "${patch_dir}/patch.md" ]]; then
  cat > "${patch_dir}/patch.md" <<'EOF'
# Patch Stack

Document the overall intent of the maintained patch stack here.
EOF
fi

if [[ ! -f "${patch_dir}/verification.sh" ]]; then
  cat > "${patch_dir}/verification.sh" <<'EOF'
#!/usr/bin/env bash

set -euo pipefail

# Add stack-wide verification here.
EOF
  chmod +x "${patch_dir}/verification.sh"
fi

if [[ ! -f "${patch_one_dir}/patch.md" ]]; then
  cat > "${patch_one_dir}/patch.md" <<'EOF'
# patch_1

Describe the intent of this patch here.
EOF
fi

if [[ ! -f "${patch_one_dir}/verification.sh" ]]; then
  cat > "${patch_one_dir}/verification.sh" <<'EOF'
#!/usr/bin/env bash

set -euo pipefail

# Add patch-specific verification here.
EOF
  chmod +x "${patch_one_dir}/verification.sh"
fi

if [[ ! -f "${patch_one_dir}/patch.patch" ]]; then
  cat > "${patch_one_dir}/patch.patch" <<'EOF'
# Replace this placeholder with a real git-format patch.
EOF
fi

if [[ ! -f "${workflow_path}" ]]; then
  mkdir -p "${workflow_dir}"
  cat > "${workflow_path}" <<EOF
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

      - uses: ${action_ref}
        id: patchsync
        with:
          config: patchsync.config.json
        env:
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          PATCHSYNC_CODEX_AUTH_JSON: \${{ secrets.PATCHSYNC_CODEX_AUTH_JSON }}
          PATCHSYNC_OPENCODE_AUTH_JSON: \${{ secrets.PATCHSYNC_OPENCODE_AUTH_JSON }}

      - uses: actions/upload-artifact@v4
        if: steps.patchsync.outputs.release-built == 'true'
        with:
          name: patchsync-artifacts
          path: \${{ steps.patchsync.outputs.artifact-paths }}
EOF
fi
