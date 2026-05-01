#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
template_dir="${script_dir}/patchsync-test-template"
target_dir="${script_dir}/patchsync-test"

rm -rf "${target_dir}"
mkdir -p "${target_dir}"
cp -R "${template_dir}/." "${target_dir}/"

cd "${target_dir}"
rm -rf .git
git init
git branch -M main
git add .
git commit -m "chore: reset patchsync test repo"
git remote remove origin >/dev/null 2>&1 || true
git remote add origin https://github.com/brrock/patchsync-test.git
git push -fff origin main
