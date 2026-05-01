import { $ } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const EXCLUDE_TEMP = ":(exclude).patchsync-tmp";

export async function cloneTargetRepo(options: {
  repo: string;
  ref: string;
  dir: string;
}) {
  await rm(options.dir, { recursive: true, force: true });
  await mkdir(options.dir, { recursive: true });

  const url = `https://github.com/${options.repo}.git`;
  await $`git clone --depth 1 --branch ${options.ref} ${url} ${options.dir}`;
}

export async function currentCommit(cwd: string) {
  return (await $`git rev-parse HEAD`.cwd(cwd).text()).trim();
}

export async function hasChanges(cwd: string) {
  const status = await $`git status --porcelain -- . ${EXCLUDE_TEMP}`
    .cwd(cwd)
    .text();
  return status.trim().length > 0;
}

export async function changedFiles(cwd: string) {
  const output = await $`git diff --name-only -- . ${EXCLUDE_TEMP}`
    .cwd(cwd)
    .text();
  const staged = await $`git diff --cached --name-only -- . ${EXCLUDE_TEMP}`
    .cwd(cwd)
    .text();
  const untracked =
    await $`git ls-files --others --exclude-standard -- . ${EXCLUDE_TEMP}`
      .cwd(cwd)
      .text();

  return [
    ...output.split("\n"),
    ...staged.split("\n"),
    ...untracked.split("\n"),
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

export async function createBranch(branch: string, cwd: string) {
  await $`git checkout -B ${branch}`.cwd(cwd);
}

export async function commitAll(message: string, cwd: string) {
  await ensureCommitIdentity(cwd);
  await $`git add -A -- . ${EXCLUDE_TEMP}`.cwd(cwd);
  await $`git commit -m ${message}`.cwd(cwd);
}

export async function pushRefspec(refspec: string, cwd: string) {
  await $`git push origin ${refspec}`.cwd(cwd);
}

export function repoWorktreePath(base: string) {
  return join(base, "target");
}

async function ensureCommitIdentity(cwd: string) {
  const name =
    process.env.INPUT_GIT_USER_NAME?.trim() || "patchsync[bot]";
  const email =
    process.env.INPUT_GIT_USER_EMAIL?.trim() ||
    "41898282+github-actions[bot]@users.noreply.github.com";

  await $`git config user.name ${name}`.cwd(cwd);
  await $`git config user.email ${email}`.cwd(cwd);
}
