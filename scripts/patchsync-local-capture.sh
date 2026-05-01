#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <patch_name> [config_path]" >&2
  exit 1
fi

patch_name="$1"
config_path="${2:-patchsync.config.json}"
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

patch_dir_rel="$(read_config patches.dir)"
patch_dir="${repo_root}/${patch_dir_rel}/${patch_name}"
patch_path="${patch_dir}/patch.patch"
patch_doc_path="${patch_dir}/patch.md"
verification_path="${patch_dir}/verification.sh"

if [[ ! -d "${target_dir}" ]]; then
  echo "Scratch tree ${target_dir} does not exist. Run scripts/patchsync-local-prepare.sh first." >&2
  exit 1
fi

diff_output="$(git -C "${target_dir}" diff --binary)"
if [[ -z "${diff_output}" ]]; then
  echo "No diff detected in ${target_dir}. Nothing to capture." >&2
  exit 1
fi

mkdir -p "${patch_dir}"
printf '%s\n' "${diff_output}" > "${patch_path}"

if [[ ! -f "${patch_doc_path}" ]]; then
  cat > "${patch_doc_path}" <<EOF
# ${patch_name}

Describe the intent of this patch here.
EOF
fi

if [[ ! -f "${verification_path}" ]]; then
  cat > "${verification_path}" <<'EOF'
#!/usr/bin/env bash

set -euo pipefail

# Add patch-specific verification here.
EOF
  chmod +x "${verification_path}"
fi

echo "Wrote ${patch_path#${repo_root}/}"
echo "Next: review ${patch_doc_path#${repo_root}/} and run scripts/patchsync-local-verify.sh ${config_path}"
