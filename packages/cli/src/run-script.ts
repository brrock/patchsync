import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function runRepoScript(scriptName: string, args: string[]): Promise<number> {
  const currentFile = fileURLToPath(import.meta.url);
  const repoRoot = resolve(dirname(currentFile), "../../..");
  const scriptPath = resolve(repoRoot, "scripts", scriptName);

  return await new Promise<number>((resolveCode, reject) => {
    const child = spawn(scriptPath, args, { stdio: "inherit" });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`script exited via signal: ${signal}`));
        return;
      }
      resolveCode(code ?? 1);
    });
  });
}

export type LocalCommand = "prepare" | "capture" | "verify";

const LOCAL_SCRIPT_BY_COMMAND: Record<LocalCommand, string> = {
  prepare: "patchsync-local-prepare.sh",
  capture: "patchsync-local-capture.sh",
  verify: "patchsync-local-verify.sh",
};

export function getLocalScriptName(command: LocalCommand): string {
  return LOCAL_SCRIPT_BY_COMMAND[command];
}
