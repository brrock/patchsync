import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { cloneTargetRepo } from "../../action/src/git";
import { loadConfig } from "../../action/src/config";
import { listPatchEntries } from "../../action/src/patches";
import { runCommandArgs } from "../../action/src/shell";

export type LocalCommand = "init" | "prepare" | "capture" | "verify";

const DEFAULT_CONFIG_PATH = "patchsync.config.json";
const DEFAULT_SCRATCH_DIR_NAME = ".patchsync-local";
const TARGET_DIR_NAME = "target";
const DEFAULT_ACTION_REF = "brrock/patchsync@main";

type CommandContext = {
  repoRoot: string;
  configPath: string;
  scratchDir: string;
  targetDir: string;
};

function getCommandContext(configPath = DEFAULT_CONFIG_PATH): CommandContext {
  const repoRoot = process.cwd();
  const scratchDir = process.env.PATCHSYNC_LOCAL_DIR
    ? resolve(process.env.PATCHSYNC_LOCAL_DIR)
    : join(repoRoot, DEFAULT_SCRATCH_DIR_NAME);

  return {
    repoRoot,
    configPath,
    scratchDir,
    targetDir: join(scratchDir, TARGET_DIR_NAME),
  };
}

async function ensureExists(path: string, message: string) {
  try {
    await access(path);
  } catch {
    throw new Error(message);
  }
}

async function writeFileIfMissing(path: string, content: string, mode?: number) {
  try {
    await access(path);
    return false;
  } catch {
    await writeFile(path, content);
    if (mode !== undefined) {
      await chmod(path, mode);
    }
    return true;
  }
}

async function applyPatchFile(targetDir: string, patchFile: string, repoRoot: string) {
  console.log(`Applying ${relative(repoRoot, patchFile)}`);
  const result = await runCommandArgs({
    argv: ["git", "apply", patchFile],
    cwd: targetDir,
    inherit: true,
  });

  if (!result.ok) {
    throw new Error(`Failed to apply ${relative(repoRoot, patchFile)}`);
  }
}

export async function runPrepare(args: string[]): Promise<number> {
  const [configArg = DEFAULT_CONFIG_PATH, targetPatch] = args;
  const context = getCommandContext(configArg);
  const config = await loadConfig({
    path: context.configPath,
    repoRoot: context.repoRoot,
  });
  const patchDir = resolve(context.repoRoot, config.patches.dir);
  const patchEntries = await listPatchEntries(patchDir);

  await mkdir(context.scratchDir, { recursive: true });
  await cloneTargetRepo({
    repo: config.target.repo,
    ref: config.target.ref,
    dir: context.targetDir,
  });

  for (const entry of patchEntries) {
    if (targetPatch && entry.name === targetPatch) {
      console.log(`Prepared ${context.targetDir} through patches before ${targetPatch}.`);
      console.log(
        `Edit files in ${context.targetDir}, then run patchsync capture ${targetPatch} ${context.configPath}`,
      );
      return 0;
    }

    for (const patchFile of entry.patchFiles) {
      await applyPatchFile(context.targetDir, patchFile, context.repoRoot);
    }
  }

  if (targetPatch) {
    console.error(`Patch directory ${targetPatch} was not found under ${config.patches.dir}.`);
    return 1;
  }

  console.log(`Prepared ${context.targetDir} with the full patch stack applied.`);
  console.log(
    `Edit files in ${context.targetDir}, then run patchsync capture <patch_name> ${context.configPath}`,
  );
  return 0;
}

export async function runInit(args: string[]): Promise<number> {
  const [rootArg = "."] = args;
  const rootDir = resolve(process.cwd(), rootArg);
  const patchDir = join(rootDir, "patches");
  const patchOneDir = join(patchDir, "patch_1");
  const configPath = join(rootDir, "patchsync.config.json");
  const latestSupportedCommitPath = join(rootDir, "LATEST_SUPPORTED_COMMIT");
  const workflowDir = join(rootDir, ".github", "workflows");
  const workflowPath = join(workflowDir, "patchsync.yml");
  const actionRef = process.env.PATCHSYNC_ACTION_REF || DEFAULT_ACTION_REF;

  await mkdir(patchOneDir, { recursive: true });
  await mkdir(workflowDir, { recursive: true });

  await writeFileIfMissing(
    configPath,
    `{
  "$schema": "./patchsync.schema.json",
  "target": {
    "repo": "owner/upstream-repo",
    "ref": "main"
  },
  "patches": {
    "dir": "patches",
    "latestSupportedCommitFile": "LATEST_SUPPORTED_COMMIT"
  },
  "verify": {
    "baseline": "bun test",
    "patched": "bun test",
    "allowSameBaselineFailure": true
  },
  "dependencies": {
    "install": {
      "enabled": true,
      "command": "bun install --frozen-lockfile"
    }
  },
  "release": {
    "enabled": true,
    "when": "every_upstream_release",
    "prereleaseSource": "ignore",
    "buildCommand": "bun run build",
    "artifacts": ["dist/**", "build/**"]
  },
  "agent": {
    "enabled": true,
    "provider": "codex",
    "model": "gpt-5.4",
    "reasoningEffort": "high",
    "mode": "session",
    "timeoutMinutes": 30,
    "install": {
      "enabled": true
    },
    "breakingChange": {
      "enabled": true,
      "createIssue": true,
      "failWorkflow": true,
      "markerFiles": ["BREAKING_CHANGE.md"],
      "labels": ["patchsync", "breaking-change"]
    },
    "acpxVersion": "latest",
    "createIssueOnBreakingChange": true,
    "onlyModify": [
      "patches/**",
      "patchsync.config.json",
      "LATEST_SUPPORTED_COMMIT"
    ]
  },
  "pullRequest": {
    "enabled": true,
    "cleanUpdates": "direct",
    "branchPrefix": "patchsync/",
    "title": "chore: update patch stack",
    "labels": ["patchsync", "ai-maintained"]
  }
}
`,
  );

  await writeFileIfMissing(latestSupportedCommitPath, "\n");
  await writeFileIfMissing(
    join(patchDir, "patch.md"),
    "# Patch Stack\n\nDocument the overall intent of the maintained patch stack here.\n",
  );
  await writeFileIfMissing(
    join(patchDir, "verification.sh"),
    "#!/usr/bin/env bash\n\nset -euo pipefail\n\n# Add stack-wide verification here.\n",
    0o755,
  );
  await writeFileIfMissing(
    join(patchOneDir, "patch.md"),
    "# patch_1\n\nDescribe the intent of this patch here.\n",
  );
  await writeFileIfMissing(
    join(patchOneDir, "verification.sh"),
    "#!/usr/bin/env bash\n\nset -euo pipefail\n\n# Add patch-specific verification here.\n",
    0o755,
  );
  await writeFileIfMissing(
    join(patchOneDir, "patch.patch"),
    "# Replace this placeholder with a real git-format patch.\n",
  );
  await writeFileIfMissing(
    workflowPath,
    `name: PatchSync

on:
  schedule:
    - cron: "17 3 * * *"
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  patchsync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: ${actionRef}
        id: patchsync
        with:
          config: patchsync.config.json
        env:
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          PATCHSYNC_CODEX_AUTH_JSON: \${{ secrets.PATCHSYNC_CODEX_AUTH_JSON }}
          PATCHSYNC_OPENCODE_AUTH_JSON: \${{ secrets.PATCHSYNC_OPENCODE_AUTH_JSON }}

      - uses: actions/upload-artifact@v4
        if: steps.patchsync.outputs.release-built == 'true'
        with:
          name: patchsync-artifacts
          path: \${{ steps.patchsync.outputs.artifact-paths }}
`,
  );

  console.log(`Initialized PatchSync scaffold in ${rootDir}`);
  console.log(`Next: update ${configPath} with your upstream repo and verify commands.`);
  return 0;
}

export async function runCapture(args: string[]): Promise<number> {
  const [patchName, configArg = DEFAULT_CONFIG_PATH] = args;
  if (!patchName) {
    console.error("Usage: patchsync capture <patch_name> [config]");
    return 1;
  }

  const context = getCommandContext(configArg);
  const config = await loadConfig({
    path: context.configPath,
    repoRoot: context.repoRoot,
  });

  await ensureExists(
    context.targetDir,
    `Scratch tree ${context.targetDir} does not exist. Run patchsync prepare first.`,
  );

  const diffResult = await runCommandArgs({
    argv: ["git", "diff", "--binary"],
    cwd: context.targetDir,
  });

  if (!diffResult.ok) {
    process.stdout.write(diffResult.stdout);
    process.stderr.write(diffResult.stderr);
    return diffResult.code;
  }

  if (!diffResult.stdout.trim()) {
    console.error(`No diff detected in ${context.targetDir}. Nothing to capture.`);
    return 1;
  }

  const patchDir = resolve(context.repoRoot, config.patches.dir, patchName);
  const patchPath = join(patchDir, "patch.patch");
  const patchDocPath = join(patchDir, "patch.md");
  const verificationPath = join(patchDir, "verification.sh");

  await mkdir(patchDir, { recursive: true });
  await writeFile(patchPath, diffResult.stdout.endsWith("\n") ? diffResult.stdout : `${diffResult.stdout}\n`);

  try {
    await access(patchDocPath);
  } catch {
    await writeFile(
      patchDocPath,
      `# ${patchName}\n\nDescribe the intent of this patch here.\n`,
    );
  }

  try {
    await access(verificationPath);
  } catch {
    await writeFile(
      verificationPath,
      `#!/usr/bin/env bash\n\nset -euo pipefail\n\n# Add patch-specific verification here.\n`,
    );
    await chmod(verificationPath, 0o755);
  }

  console.log(`Wrote ${relative(context.repoRoot, patchPath)}`);
  console.log(`Next: review ${relative(context.repoRoot, patchDocPath)} and run patchsync verify ${context.configPath}`);
  return 0;
}

export async function runVerify(args: string[]): Promise<number> {
  const [configArg = DEFAULT_CONFIG_PATH] = args;
  const context = getCommandContext(configArg);
  const actionEntrypoint = resolve(context.repoRoot, "packages/action/src/main.ts");

  await ensureExists(actionEntrypoint, `PatchSync action entrypoint was not found at ${actionEntrypoint}.`);

  const result = await runCommandArgs({
    argv: [process.execPath, actionEntrypoint],
    cwd: context.repoRoot,
    inherit: true,
    env: {
      ...process.env,
      INPUT_CONFIG: context.configPath,
      INPUT_MODE: "check",
      PATCHSYNC_REPO_ROOT: context.repoRoot,
      PATCHSYNC_ACTION_PATH: context.repoRoot,
    },
  });

  return result.code;
}

export async function runLocalCommand(
  command: LocalCommand,
  args: string[],
): Promise<number> {
  switch (command) {
    case "init":
      return runInit(args);
    case "prepare":
      return runPrepare(args);
    case "capture":
      return runCapture(args);
    case "verify":
      return runVerify(args);
  }
}
