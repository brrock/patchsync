import * as core from "@actions/core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseAcpxJsonLines, type AcpxRunSummary } from "./acpx-events";
import type { PatchSyncConfig } from "./config";
import type { PatchSyncLogger } from "./logger";
import { runCommand } from "./shell";

const BUILT_IN_AGENT_INSTALLERS: Record<string, string> = {
  claude: "bun i -g @anthropic-ai/claude-code",
  codex: "bun i -g @openai/codex",
  copilot: "bun i -g @github/copilot",
  cursor: "curl -fsSL https://cursor.com/install | bash",
  droid: "curl -fsSL https://app.factory.ai/cli | sh",
  gemini: "bun i -g @google/gemini-cli",
  iflow: "bun i -g @iflow-ai/iflow-cli@latest",
  kilocode: "bun i -g @kilocode/cli",
  kimi: "curl -LsSf https://code.kimi.com/install.sh | bash",
  kiro: "curl -fsSL https://cli.kiro.dev/install | bash",
  opencode: "bun i -g opencode-ai@latest",
  qoder: "bun i -g @qoder-ai/qodercli",
  qwen: "bun i -g @qwen-code/qwen-code@latest",
};

export async function installCodingAgent(options: {
  config: PatchSyncConfig;
  repoRoot: string;
  logger: PatchSyncLogger;
}) {
  const install = options.config.agent.install;

  if (!options.config.agent.enabled || !install.enabled) {
    return;
  }

  const command = template(resolveInstallCommand(options.config), {
    provider: options.config.agent.provider,
    model: options.config.agent.model ?? "",
    acpxVersion: options.config.agent.acpxVersion,
  });

  core.info(`Installing ACPX agent provider: ${options.config.agent.provider}`);
  const result = await runCommand({
    command,
    cwd: options.repoRoot,
    env: process.env,
    timeoutMs: options.config.agent.timeoutMinutes * 60_000,
  });
  const installSummary = {
    provider: options.config.agent.provider,
    command,
    exitCode: result.code,
    ok: result.ok,
  };
  options.logger.appendSummary("Agent Install", installSummary);
  core.info(`Agent install: ${JSON.stringify(installSummary)}`);
  if (result.stdout.trim()) {
    core.info(`Agent install stdout:\n${truncate(result.stdout, 4000)}`);
  }
  if (result.stderr.trim()) {
    core.warning(`Agent install stderr:\n${truncate(result.stderr, 4000)}`);
  }

  if (!result.ok) {
    throw new Error(
      `Coding agent install failed with exit code ${result.code}`,
    );
  }
}

export async function runAcpxRepair(options: {
  config: PatchSyncConfig;
  repoRoot: string;
  targetDir: string;
  latestCommit: string;
  failureSummary: string;
  logger: PatchSyncLogger;
}) {
  const patchDoc = await readPatchDocs(
    join(options.repoRoot, options.config.patches.dir),
  );

  const globalArgs = buildGlobalArgs(options.config);

  const prompt = `
You are repairing a maintained patch stack for PatchSync.

Goal:
- Make the patch stack apply cleanly to upstream commit ${options.latestCommit}.
- Preserve the intent described in the patch docs.
- Edit only this target repository working tree to represent the desired patched state.
- Do not commit.
- Do not push.
- Do not modify GitHub workflow files.
- Prefer the smallest possible change.
- If upstream introduced a real breaking change that makes the patch impossible or unsafe, create BREAKING_CHANGE.md with a clear explanation instead of attempting a massive speculative refactor.
- If the repair would require broad architectural changes, rewrites, or risky behavior changes, create BREAKING_CHANGE.md and explain the human decision needed.

Patch directory format:
- The outer orchestrator stores patches in patches/patch_*/ directories.
- Each directory can contain patch.md, verification.sh, and one or more .patch files.
- The outer orchestrator will regenerate .patch files from your repaired working tree.

Patch docs:
${patchDoc || "(no patch docs found)"}

Failure summary:
${options.failureSummary}

Verification:
- patched: ${options.config.verify.patched}
- root/per-patch verification.sh scripts are also run by the orchestrator.
`.trim();

  if (options.config.agent.mode === "session") {
    await ensureSessionConfigured({
      config: options.config,
      targetDir: options.targetDir,
    });
  } else if (
    normalizeProvider(options.config.agent.provider) === "codex" &&
    options.config.agent.reasoningEffort
  ) {
    core.warning(
      "agent.reasoningEffort is only applied for codex session mode; exec mode will ignore it.",
    );
  }

  const args =
    options.config.agent.mode === "exec"
      ? [...globalArgs, options.config.agent.provider, "exec", prompt]
      : [...globalArgs, options.config.agent.provider, prompt];

  const result = await runCommand({
    command: shellJoin([
      "bunx",
      `acpx@${options.config.agent.acpxVersion}`,
      ...args,
    ]),
    cwd: options.targetDir,
    env: {
      ...process.env,
      PATCHSYNC: "1",
      PATCHSYNC_LATEST_UPSTREAM_COMMIT: options.latestCommit,
    },
    timeoutMs: options.config.agent.timeoutMinutes * 60_000,
  });

  const parsed = parseAcpxJsonLines(result.stdout);
  options.logger.appendSummary("ACPX", {
    exitCode: result.code,
    ok: result.ok,
    eventCount: parsed.summary.eventCount,
    eventTypes: parsed.summary.eventTypes,
    toolCalls: parsed.summary.toolCalls.slice(-10),
    errors: parsed.summary.errors.slice(-10),
  });

  emitAcpxLogLines(parsed.summary, result.stderr);

  if (!result.ok) {
    throw new Error(`ACPX repair failed with exit code ${result.code}`);
  }
}

async function readPatchDocs(patchDir: string) {
  const glob = new Bun.Glob("**/patch.md");
  const docs: string[] = [];

  for await (const path of glob.scan({ cwd: patchDir, absolute: true })) {
    const body = await readFile(path, "utf8").catch(() => "");
    if (body.trim()) {
      docs.push(`## ${path}\n\n${body}`);
    }
  }

  return docs.join("\n\n");
}

function template(value: string, replacements: Record<string, string>) {
  return value.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => {
    return replacements[key] ?? match;
  });
}

function resolveInstallCommand(config: PatchSyncConfig) {
  if (config.agent.install.command) {
    return config.agent.install.command;
  }

  const provider = normalizeProvider(config.agent.provider);
  const command = BUILT_IN_AGENT_INSTALLERS[provider];

  if (!command) {
    throw new Error(
      [
        `No built-in install command for ACPX agent provider "${config.agent.provider}".`,
        "Set agent.install.command in patchsync.config.json to install this provider.",
      ].join(" "),
    );
  }

  return command;
}

function normalizeProvider(provider: string) {
  return provider.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildGlobalArgs(config: PatchSyncConfig) {
  const args = ["--approve-all", "--non-interactive-permissions", "fail"];

  if (config.agent.model) {
    args.push("--model", config.agent.model);
  }

  return args;
}

async function ensureSessionConfigured(options: {
  config: PatchSyncConfig;
  targetDir: string;
}) {
  const globalArgs = buildGlobalArgs(options.config);
  const prefix = [
    "bunx",
    `acpx@${options.config.agent.acpxVersion}`,
    ...globalArgs,
  ];

  const ensureSession = await runCommand({
    command: shellJoin([
      ...prefix,
      options.config.agent.provider,
      "sessions",
      "ensure",
    ]),
    cwd: options.targetDir,
    env: process.env,
  });

  if (!ensureSession.ok) {
    throw new Error(
      `ACPX session setup failed with exit code ${ensureSession.code}`,
    );
  }

  if (
    normalizeProvider(options.config.agent.provider) === "codex" &&
    options.config.agent.reasoningEffort
  ) {
    const thoughtLevel = await runCommand({
      command: shellJoin([
        ...prefix,
        options.config.agent.provider,
        "set",
        "thought_level",
        options.config.agent.reasoningEffort,
      ]),
      cwd: options.targetDir,
      env: process.env,
    });

    if (!thoughtLevel.ok) {
      throw new Error(
        `ACPX thought_level setup failed with exit code ${thoughtLevel.code}`,
      );
    }
  }
}

function shellJoin(args: string[]) {
  return args.map((arg) => JSON.stringify(arg)).join(" ");
}

function emitAcpxLogLines(summary: AcpxRunSummary, stderr: string) {
  const eventKinds = Object.entries(summary.eventTypes)
    .map(([type, count]) => `${type}:${count}`)
    .join(", ");

  core.info(
    `ACPX events: ${summary.eventCount}${eventKinds ? ` (${eventKinds})` : ""}`,
  );

  if (summary.finalAssistantText) {
    core.info(`ACPX final text: ${truncate(summary.finalAssistantText, 500)}`);
  }

  for (const error of summary.errors.slice(0, 5)) {
    core.warning(`ACPX event error: ${truncate(error, 500)}`);
  }

  if (stderr.trim()) {
    core.warning(`ACPX stderr:\n${truncate(stderr, 4000)}`);
  }
}

function truncate(value: string, length: number) {
  return value.length <= length ? value : `${value.slice(0, length)}...`;
}
