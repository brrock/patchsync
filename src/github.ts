import * as github from "@actions/github";
import { $ } from "bun";

export type UpstreamRelease = {
  tagName: string;
  name: string;
  prerelease: boolean;
};

export function repositoryBaseBranch() {
  return github.context.payload.repository?.default_branch ?? "main";
}

export async function pushBranch(branch: string, cwd: string) {
  await $`git push --set-upstream origin ${branch} --force-with-lease`.cwd(cwd);
}

export async function createPullRequest(options: {
  token: string;
  branch: string;
  title: string;
  body: string;
  labels: string[];
}) {
  const octokit = github.getOctokit(options.token);
  const context = github.context;

  const response = await octokit.rest.pulls.create({
    owner: context.repo.owner,
    repo: context.repo.repo,
    title: options.title,
    body: options.body,
    head: options.branch,
    base: context.payload.repository?.default_branch ?? "main",
  });

  if (options.labels.length > 0) {
    await octokit.rest.issues.addLabels({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: response.data.number,
      labels: options.labels,
    });
  }

  return response.data.html_url;
}

export async function createFailureIssue(options: {
  token: string;
  title: string;
  body: string;
  labels: string[];
}) {
  const octokit = github.getOctokit(options.token);
  const context = github.context;

  const response = await octokit.rest.issues.create({
    owner: context.repo.owner,
    repo: context.repo.repo,
    title: options.title,
    body: options.body,
    labels: options.labels,
  });

  return response.data.html_url;
}

export async function fetchLatestUpstreamRelease(options: {
  repo: string;
  token: string;
  prereleaseSource: "ignore" | "include" | "only";
}): Promise<UpstreamRelease> {
  const response = await fetch(
    `https://api.github.com/repos/${options.repo}/releases?per_page=20`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch upstream releases for ${options.repo}: ${response.status}`,
    );
  }

  const releases = (await response.json()) as Array<{
    draft: boolean;
    prerelease: boolean;
    tag_name: string;
    name: string | null;
  }>;

  const filtered = releases.filter((release) => {
    if (release.draft) {
      return false;
    }
    if (options.prereleaseSource === "ignore") {
      return !release.prerelease;
    }
    if (options.prereleaseSource === "only") {
      return release.prerelease;
    }
    return true;
  });

  const selected = filtered[0];
  if (!selected) {
    throw new Error(
      `No upstream release matched prereleaseSource=${options.prereleaseSource} for ${options.repo}`,
    );
  }

  return {
    tagName: selected.tag_name,
    name: selected.name ?? selected.tag_name,
    prerelease: selected.prerelease,
  };
}
