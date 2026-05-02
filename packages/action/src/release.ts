import * as core from "@actions/core";
import { stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { PatchSyncConfig } from "./config";
import { fetchLatestUpstreamRelease } from "./github";
import type { PatchSyncLogger } from "./logger";
import { runCommand } from "./shell";

export type ResolvedUpstream = {
  ref: string;
  releaseTag?: string;
  releaseName?: string;
  releasePrerelease?: boolean;
  releasePolicyTriggered: boolean;
  releasePolicyReason: string;
};

export async function resolveUpstream(options: {
  config: PatchSyncConfig;
  token: string;
}): Promise<ResolvedUpstream> {
  if (!options.config.release.enabled) {
    return {
      ref: options.config.target.ref,
      releasePolicyTriggered: false,
      releasePolicyReason: "release disabled",
    };
  }

  if (options.config.release.when !== "every_upstream_release") {
    return {
      ref: options.config.target.ref,
      releasePolicyTriggered:
        options.config.release.when === "every_upstream_commit" ||
        shouldRunNightly(options.config.release.when),
      releasePolicyReason: releaseReason(options.config.release.when),
    };
  }

  const release = await fetchLatestUpstreamRelease({
    repo: options.config.target.repo,
    token: options.token,
    prereleaseSource: options.config.release.prereleaseSource,
  });

  return {
    ref: release.tagName,
    releaseTag: release.tagName,
    releaseName: release.name,
    releasePrerelease: release.prerelease,
    releasePolicyTriggered: true,
    releasePolicyReason: "latest upstream release",
  };
}

export async function maybeInstallDependencies(options: {
  config: PatchSyncConfig;
  cwd: string;
  phase: string;
  logger: PatchSyncLogger;
}) {
  const install = options.config.dependencies.install;

  if (!install?.enabled) {
    return;
  }

  core.info(`Installing upstream dependencies for ${options.phase}`);
  const result = await runCommand({
    command: install.command,
    cwd: options.cwd,
    timeoutMs: 30 * 60_000,
  });

  const summary = {
    phase: options.phase,
    ok: result.ok,
    code: result.code,
    command: install.command,
  };
  options.logger.appendSummary("Dependencies", summary);
  core.info(`Dependency install: ${JSON.stringify(summary)}`);

  if (!result.ok) {
    if (result.stdout.trim()) {
      core.warning(
        `Dependency install stdout:\n${truncate(result.stdout, 4000)}`,
      );
    }
    if (result.stderr.trim()) {
      core.warning(
        `Dependency install stderr:\n${truncate(result.stderr, 4000)}`,
      );
    }
    throw new Error(
      `Dependency install failed during ${options.phase} with exit code ${result.code}`,
    );
  }
}

export async function maybeBuildReleaseArtifacts(options: {
  config: PatchSyncConfig;
  cwd: string;
  upstream: ResolvedUpstream;
  logger: PatchSyncLogger;
}) {
  if (!options.config.release.enabled) {
    return {
      built: false,
      artifactPaths: [] as string[],
      reason: "release disabled",
    };
  }

  const triggered = releaseShouldRun(options.config.release.when);
  if (!triggered) {
    const reason = releaseReason(options.config.release.when);
    core.info(`Skipping release build: ${reason}`);
    options.logger.appendSummary("Release", { built: false, reason });
    return {
      built: false,
      artifactPaths: [] as string[],
      reason,
    };
  }

  if (!options.config.release.buildCommand) {
    throw new Error(
      "release.buildCommand must be set when release.enabled is true",
    );
  }

  core.info(
    `Building release artifacts with policy ${options.config.release.when}`,
  );
  const buildResult = await runCommand({
    command: options.config.release.buildCommand,
    cwd: options.cwd,
    timeoutMs: 60 * 60_000,
  });

  const buildSummary = {
    ok: buildResult.ok,
    code: buildResult.code,
    command: options.config.release.buildCommand,
    policy: options.config.release.when,
    upstreamReleaseTag: options.upstream.releaseTag ?? null,
  };
  core.info(`Release build: ${JSON.stringify(buildSummary)}`);

  if (!buildResult.ok) {
    if (buildResult.stdout.trim()) {
      core.warning(
        `Release build stdout:\n${truncate(buildResult.stdout, 4000)}`,
      );
    }
    if (buildResult.stderr.trim()) {
      core.warning(
        `Release build stderr:\n${truncate(buildResult.stderr, 4000)}`,
      );
    }
    throw new Error(`Release build failed with exit code ${buildResult.code}`);
  }

  const artifactPaths = await collectArtifacts(
    options.cwd,
    options.config.release.artifacts,
  );
  if (artifactPaths.length === 0) {
    throw new Error("No release artifacts matched release.artifacts");
  }

  const summary = {
    built: true,
    policy: options.config.release.when,
    artifacts: artifactPaths.map((path) => relative(options.cwd, path)),
    upstreamReleaseTag: options.upstream.releaseTag ?? null,
  };
  options.logger.appendSummary("Release", summary);
  core.info(`Release artifacts: ${JSON.stringify(summary)}`);

  return {
    built: true,
    artifactPaths,
    reason: releaseReason(options.config.release.when),
  };
}

function releaseShouldRun(when: PatchSyncConfig["release"]["when"]) {
  if (when === "every_upstream_nightly") {
    return shouldRunNightly(when);
  }

  return true;
}

function shouldRunNightly(when: PatchSyncConfig["release"]["when"]) {
  return (
    when === "every_upstream_nightly" &&
    process.env.GITHUB_EVENT_NAME === "schedule"
  );
}

function releaseReason(when: PatchSyncConfig["release"]["when"]) {
  if (when === "every_upstream_nightly") {
    return process.env.GITHUB_EVENT_NAME === "schedule"
      ? "scheduled nightly run"
      : "not a scheduled nightly run";
  }

  if (when === "every_upstream_release") {
    return "latest upstream release";
  }

  return "every upstream commit";
}

async function collectArtifacts(cwd: string, patterns: string[]) {
  const resolved = new Set<string>();

  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern);

    for await (const path of glob.scan({ cwd, absolute: true })) {
      if (await isFile(path)) {
        resolved.add(path);
      }
    }
  }

  return [...resolved].sort();
}

async function isFile(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function truncate(value: string, length: number) {
  return value.length <= length ? value : `${value.slice(0, length)}...`;
}
