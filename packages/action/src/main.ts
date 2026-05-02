import * as core from "@actions/core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { minimatch } from "minimatch";
import { installCodingAgent, runAcpxRepair } from "./acpx";
import { loadConfig, type PatchSyncConfig } from "./config";
import {
  changedFiles,
  cloneTargetRepo,
  commitAll,
  createBranch,
  currentCommit,
  hasChanges,
  pushRefspec,
  repoWorktreePath,
} from "./git";
import {
  createFailureIssue,
  createPullRequest,
  pushBranch,
  repositoryBaseBranch,
} from "./github";
import { createLogger, flushSummary } from "./logger";
import { applyPatches, regenerateSinglePatch } from "./patches";
import {
  maybeBuildReleaseArtifacts,
  maybeInstallDependencies,
  resolveUpstream,
} from "./release";
import {
  runPatchVerificationScripts,
  runVerify,
  summarizeVerifyFailures,
  verifyCompatible,
} from "./verify";

const repoRoot = resolve(process.env.PATCHSYNC_REPO_ROOT ?? process.cwd());

async function main() {
  const configPath = process.env.INPUT_CONFIG || "patchsync.config.json";
  const mode = process.env.INPUT_MODE || "pr";
  const token = process.env.GITHUB_TOKEN || "";
  const tmpDir = join(repoRoot, ".patchsync-tmp");
  const targetDir = repoWorktreePath(tmpDir);
  const logger = await createLogger();

  await mkdir(tmpDir, { recursive: true });
  const config = await loadConfig({ path: configPath, repoRoot });
  let status: "clean" | "repaired" | "failed" = "failed";
  let latestCommit = "";
  let failureSummary = "";
  let upstreamReleaseTag = "";
  let artifactPaths: string[] = [];
  let repairableFailure = false;
  const upstream = await resolveUpstream({ config, token });
  upstreamReleaseTag = upstream.releaseTag ?? "";
  core.setOutput("release-trigger", upstream.releasePolicyReason);
  core.setOutput("upstream-release-tag", upstreamReleaseTag);

  try {
    try {
      core.info(`Cloning ${config.target.repo}@${upstream.ref}`);
      await cloneTargetRepo({
        repo: config.target.repo,
        ref: upstream.ref,
        dir: targetDir,
      });

      latestCommit = await currentCommit(targetDir);
      core.setOutput("latest-supported-commit", latestCommit);

      await maybeInstallDependencies({
        config,
        cwd: targetDir,
        phase: "baseline",
        logger,
      });

      const baseline = await runVerify(
        "baseline",
        config.verify.baseline,
        targetDir,
      );
      logVerifyResult(baseline);

      repairableFailure = true;
      const patchEntries = await applyPatches({
        targetDir,
        patchDir: join(repoRoot, config.patches.dir),
      });

      await maybeInstallDependencies({
        config,
        cwd: targetDir,
        phase: "patched",
        logger,
      });

      const patched = await runVerify(
        "patched",
        config.verify.patched,
        targetDir,
      );
      logVerifyResult(patched);
      const scriptResults = await runPatchVerificationScripts({
        patchDir: join(repoRoot, config.patches.dir),
        targetDir,
        patches: patchEntries,
      });
      scriptResults.forEach(logVerifyResult);

      const compatible = verifyCompatible({
        baseline,
        patched,
        allowSameBaselineFailure: config.verify.allowSameBaselineFailure,
      });

      const scriptFailureSummary = summarizeVerifyFailures(scriptResults);

      if (!compatible || scriptFailureSummary) {
        failureSummary = [
          !compatible ? summarizeVerifyFailures([patched]) : "",
          scriptFailureSummary,
        ]
          .filter(Boolean)
          .join("\n\n");

        throw new Error("Patch verification failed");
      }

      repairableFailure = false;
      const releaseResult = await maybeBuildReleaseArtifacts({
        config,
        cwd: targetDir,
        upstream,
        logger,
      });
      artifactPaths = releaseResult.artifactPaths;
      core.setOutput("release-built", String(releaseResult.built));
      core.setOutput("artifact-paths", artifactPaths.join("\n"));

      await markSupported(config, latestCommit);
      await maybePublishChanges(config, token, latestCommit, "clean");

      status = "clean";
      core.setOutput("status", status);
      return;
    } catch (error) {
      failureSummary ||= error instanceof Error ? error.message : String(error);

      if (!repairableFailure || !config.agent.enabled || mode === "check") {
        throw error;
      }
    }

    core.info("Patch stack failed. Starting ACPX repair.");

    await installCodingAgent({ config, repoRoot, logger });

    await runAcpxRepair({
      config,
      repoRoot,
      targetDir,
      latestCommit,
      failureSummary,
      logger,
    });

    const breakingChange = await detectBreakingChange(config, targetDir);

    if (breakingChange) {
      await maybeCreateBreakingChangeIssue({
        config,
        token,
        latestCommit,
        failureSummary,
        breakingChange,
      });

      if (config.agent.breakingChange.failWorkflow) {
        throw new Error(
          `Agent reported a breaking upstream change in ${breakingChange.file}`,
        );
      }

      return;
    }

    await regenerateSinglePatch({
      targetDir,
      patchDir: join(repoRoot, config.patches.dir),
    });

    await markSupported(config, latestCommit);
    await assertOnlyAllowedFilesChanged(config.agent.onlyModify);

    core.info("Re-running verification from a clean clone.");

    await cloneTargetRepo({
      repo: config.target.repo,
      ref: upstream.ref,
      dir: targetDir,
    });

    await maybeInstallDependencies({
      config,
      cwd: targetDir,
      phase: "repaired-baseline",
      logger,
    });

    const patchEntries = await applyPatches({
      targetDir,
      patchDir: join(repoRoot, config.patches.dir),
    });

    await maybeInstallDependencies({
      config,
      cwd: targetDir,
      phase: "repaired-patched",
      logger,
    });

    const patched = await runVerify(
      "patched",
      config.verify.patched,
      targetDir,
    );
    logVerifyResult(patched);
    const scriptResults = await runPatchVerificationScripts({
      patchDir: join(repoRoot, config.patches.dir),
      targetDir,
      patches: patchEntries,
    });
    scriptResults.forEach(logVerifyResult);

    const scriptFailureSummary = summarizeVerifyFailures(scriptResults);

    if (!patched.ok || scriptFailureSummary) {
      await maybeCreateFailureIssue(
        config,
        token,
        latestCommit,
        failureSummary,
      );
      throw new Error("ACPX repair did not produce a passing patch stack");
    }

    const releaseResult = await maybeBuildReleaseArtifacts({
      config,
      cwd: targetDir,
      upstream,
      logger,
    });
    artifactPaths = releaseResult.artifactPaths;
    core.setOutput("release-built", String(releaseResult.built));
    core.setOutput("artifact-paths", artifactPaths.join("\n"));

    await maybePublishChanges(config, token, latestCommit, "repaired");

    status = "repaired";
    core.setOutput("status", status);
  } catch (error) {
    failureSummary = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    logger.appendSummary("PatchSync", {
      status,
      latestCommit,
      failureSummary,
      upstreamReleaseTag,
      artifactPaths,
    });
    core.info(
      `PatchSync summary: ${JSON.stringify({ status, latestCommit, failureSummary, upstreamReleaseTag, artifactPaths })}`,
    );
    core.setOutput("status", status);
    core.setOutput("release-built", String(artifactPaths.length > 0));
    core.setOutput("artifact-paths", artifactPaths.join("\n"));
    core.setOutput("upstream-release-tag", upstreamReleaseTag);
    await flushSummary();
  }
}

function logVerifyResult(result: {
  label: string;
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}) {
  const summary = {
    label: result.label,
    ok: result.ok,
    code: result.code,
  };
  core.info(`Verify result: ${JSON.stringify(summary)}`);

  if (!result.ok) {
    if (result.stdout.trim()) {
      core.warning(`${result.label} stdout:\n${truncate(result.stdout, 4000)}`);
    }
    if (result.stderr.trim()) {
      core.warning(`${result.label} stderr:\n${truncate(result.stderr, 4000)}`);
    }
  }
}

function truncate(value: string, length: number) {
  return value.length <= length ? value : `${value.slice(0, length)}...`;
}

async function markSupported(config: PatchSyncConfig, commit: string) {
  const path = join(repoRoot, config.patches.latestSupportedCommitFile);
  await writeFile(path, `${commit}\n`, "utf8");
}

async function assertOnlyAllowedFilesChanged(patterns: string[]) {
  const files = await changedFiles(repoRoot);
  const disallowed = files.filter(
    (file) => !patterns.some((pattern) => minimatch(file, pattern)),
  );

  if (disallowed.length > 0) {
    throw new Error(
      [
        "Agent modified files outside the allowed patch maintenance set:",
        ...disallowed.map((file) => `- ${file}`),
      ].join("\n"),
    );
  }
}

async function maybePublishChanges(
  config: PatchSyncConfig,
  token: string,
  latestCommit: string,
  status: "clean" | "repaired",
) {
  if (!(await hasChanges(repoRoot))) {
    core.info("No patch repo changes to publish.");
    return;
  }

  if (process.env.INPUT_MODE === "fix" || !token) {
    core.info("Changes exist, but publishing is disabled for this run.");
    return;
  }

  const shortSha = latestCommit.slice(0, 12);
  const publishMode =
    status === "clean"
      ? config.pullRequest.cleanUpdates
      : config.pullRequest.enabled
        ? "pull_request"
        : "direct";

  if (publishMode === "disabled") {
    core.info("Changes exist, but publishing is disabled for clean updates.");
    return;
  }

  if (publishMode === "direct") {
    const baseBranch = repositoryBaseBranch();
    await commitAll(`chore: update patches for ${shortSha}`, repoRoot);
    await pushRefspec(`HEAD:${baseBranch}`, repoRoot);
    core.info(`Published patch updates directly to ${baseBranch}.`);
    return;
  }

  if (process.env.INPUT_CREATE_PR === "false") {
    core.info("Changes exist, but PR creation is disabled by input.");
    return;
  }

  const branch = `${config.pullRequest.branchPrefix}${shortSha}`;

  await createBranch(branch, repoRoot);
  await commitAll(`chore: update patches for ${shortSha}`, repoRoot);
  await pushBranch(branch, repoRoot);

  const url = await createPullRequest({
    token,
    branch,
    title: `${config.pullRequest.title} (${shortSha})`,
    labels: config.pullRequest.labels,
    body: [
      "PatchSync updated the maintained patch stack.",
      "",
      `Status: \`${status}\``,
      `Latest supported upstream commit: \`${latestCommit}\``,
      "",
      "`LATEST_SUPPORTED_COMMIT` is informational only. The workflow always checks the latest upstream ref.",
    ].join("\n"),
  });

  core.setOutput("pull-request-url", url);
}

async function maybeCreateFailureIssue(
  config: PatchSyncConfig,
  token: string,
  latestCommit: string,
  failureSummary: string,
) {
  if (
    !token ||
    !config.agent.createIssueOnBreakingChange ||
    process.env.INPUT_CREATE_ISSUE_ON_FAILURE === "false"
  ) {
    return;
  }

  await createFailureIssue({
    token,
    title: "PatchSync could not repair patch stack",
    labels: ["patchsync", "needs-human"],
    body: [
      "PatchSync could not repair the patch stack automatically.",
      "",
      `Target: \`${config.target.repo}@${latestCommit}\``,
      `Agent: \`${config.agent.provider}\``,
      config.agent.model ? `Model: \`${config.agent.model}\`` : "",
      "",
      "Failure summary:",
      "```text",
      failureSummary.slice(0, 12000),
      "```",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

async function detectBreakingChange(
  config: PatchSyncConfig,
  targetDir: string,
) {
  if (!config.agent.breakingChange.enabled) {
    return null;
  }

  for (const marker of config.agent.breakingChange.markerFiles) {
    const path = join(targetDir, marker);
    const body = await readFile(path, "utf8").catch(() => null);

    if (body !== null) {
      return {
        file: marker,
        body,
      };
    }
  }

  return null;
}

async function maybeCreateBreakingChangeIssue(options: {
  config: PatchSyncConfig;
  token: string;
  latestCommit: string;
  failureSummary: string;
  breakingChange: { file: string; body: string };
}) {
  if (
    !options.token ||
    !options.config.agent.breakingChange.createIssue ||
    process.env.INPUT_CREATE_ISSUE_ON_FAILURE === "false"
  ) {
    return;
  }

  await createFailureIssue({
    token: options.token,
    title: "PatchSync detected breaking upstream changes",
    labels: options.config.agent.breakingChange.labels,
    body: [
      "The configured ACPX agent reported that the patch stack should not be repaired automatically.",
      "",
      `Target: \`${options.config.target.repo}@${options.latestCommit}\``,
      `Agent: \`${options.config.agent.provider}\``,
      options.config.agent.model
        ? `Model: \`${options.config.agent.model}\``
        : "",
      `Marker file: \`${options.breakingChange.file}\``,
      "",
      "Agent report:",
      "```md",
      options.breakingChange.body.slice(0, 12000),
      "```",
      "",
      "Original failure summary:",
      "```text",
      options.failureSummary.slice(0, 8000),
      "```",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

main().catch((error) => {
  core.setOutput("status", "failed");
  core.setFailed(error instanceof Error ? error.message : String(error));
});
