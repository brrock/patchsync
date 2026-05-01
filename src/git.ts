import { $ } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

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
  const status = await $`git status --porcelain`.cwd(cwd).text();
  return status.trim().length > 0;
}

export async function changedFiles(cwd: string) {
  const output = await $`git diff --name-only`.cwd(cwd).text();
  const staged = await $`git diff --cached --name-only`.cwd(cwd).text();
  const untracked = await $`git ls-files --others --exclude-standard`
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
  await $`git add -A`.cwd(cwd);
  await $`git commit -m ${message}`.cwd(cwd);
}

export async function pushRefspec(refspec: string, cwd: string) {
  await $`git push origin ${refspec}`.cwd(cwd);
}

export function repoWorktreePath(base: string) {
  return join(base, "target");
}
