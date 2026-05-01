#!/usr/bin/env bash

set -euo pipefail

config_path="${1:-patchsync.config.json}"
target_patch="${2:-}"
repo_root="$(pwd)"
scratch_dir="${PATCHSYNC_LOCAL_DIR:-${repo_root}/.patchsync-local}"
target_dir="${scratch_dir}/target"

read_config() {
  local key="$1"
  bun -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const key = process.argv[2];
    const config = JSON.parse(fs.readFileSync(path, "utf8"));
    const value = key.split(".").reduce((current, part) => current?.[part], config);
    if (typeof value === "undefined" || value === null) process.exit(1);
    process.stdout.write(String(value));
  ' "$config_path" "$key"
}

target_repo="$(read_config target.repo)"
target_ref="$(read_config target.ref)"
patch_dir_rel="$(read_config patches.dir)"
patch_dir="${repo_root}/${patch_dir_rel}"

rm -rf "${target_dir}"
mkdir -p "${scratch_dir}"

git clone --depth 1 --branch "${target_ref}" "https://github.com/${target_repo}.git" "${target_dir}"

apply_patch_file() {
  local patch_file="$1"
  echo "Applying ${patch_file#${repo_root}/}"
  git -C "${target_dir}" apply "${patch_file}"
}

shopt -s nullglob

for patch_file in "${patch_dir}"/*.patch; do
  apply_patch_file "${patch_file}"
done

for patch_subdir in "${patch_dir}"/patch_*; do
  [[ -d "${patch_subdir}" ]] || continue

  patch_name="$(basename "${patch_subdir}")"
  if [[ -n "${target_patch}" && "${patch_name}" == "${target_patch}" ]]; then
    echo "Prepared ${target_dir} through patches before ${target_patch}."
    echo "Edit files in ${target_dir}, then run scripts/patchsync-local-capture.sh ${target_patch} ${config_path}"
    exit 0
  fi

  for patch_file in "${patch_subdir}"/*.patch; do
    apply_patch_file "${patch_file}"
  done
done

if [[ -n "${target_patch}" ]]; then
  echo "Patch directory ${target_patch} was not found under ${patch_dir_rel}." >&2
  exit 1
fi

echo "Prepared ${target_dir} with the full patch stack applied."
echo "Edit files in ${target_dir}, then run scripts/patchsync-local-capture.sh <patch_name> ${config_path}"
