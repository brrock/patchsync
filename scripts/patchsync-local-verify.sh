#!/usr/bin/env bash

set -euo pipefail

config_path="${1:-patchsync.config.json}"
repo_root="$(pwd)"

export INPUT_CONFIG="${config_path}"
export INPUT_MODE="check"
export PATCHSYNC_REPO_ROOT="${repo_root}"
export PATCHSYNC_ACTION_PATH="${repo_root}"

bun run "${repo_root}/src/main.ts"
