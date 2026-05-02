import { access } from "node:fs/promises";
import { join, relative } from "node:path";
import type { PatchEntry } from "./patches";
import { runCommand, type CommandResult } from "./shell";

export type VerifyResult = CommandResult & {
  label: string;
};

export async function runVerify(
  label: string,
  command: string | undefined,
  cwd: string,
): Promise<VerifyResult> {
  if (!command) {
    return {
      label,
      ok: true,
      code: 0,
      stdout: "",
      stderr: "",
    };
  }

  return {
    label,
    ...(await runCommand({ command, cwd })),
  };
}

export async function runPatchVerificationScripts(options: {
  patchDir: string;
  targetDir: string;
  patches: PatchEntry[];
}): Promise<VerifyResult[]> {
  const scripts = Array.from(
    new Set([
      join(options.patchDir, "verification.sh"),
      ...options.patches.map((patch) => join(patch.dir, "verification.sh")),
    ]),
  );

  const results: VerifyResult[] = [];

  for (const script of scripts) {
    if (!(await fileExists(script))) {
      continue;
    }

    const label = `patch verification: ${relative(options.patchDir, script)}`;
    results.push(
      await runVerify(
        label,
        `bash ${JSON.stringify(script)}`,
        options.targetDir,
      ),
    );
  }

  return results;
}

export function verifyCompatible(options: {
  baseline: VerifyResult;
  patched: VerifyResult;
  allowSameBaselineFailure: boolean;
}) {
  if (options.patched.ok) {
    return true;
  }

  if (!options.allowSameBaselineFailure) {
    return false;
  }

  return !options.baseline.ok && options.baseline.code === options.patched.code;
}

export function summarizeVerifyFailures(results: VerifyResult[]) {
  return results
    .filter((result) => !result.ok)
    .map((result) =>
      [
        `${result.label} failed with exit code ${result.code}`,
        "stdout:",
        result.stdout.slice(0, 4000),
        "stderr:",
        result.stderr.slice(0, 4000),
      ].join("\n"),
    )
    .join("\n\n");
}

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
