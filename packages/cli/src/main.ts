import { getLocalScriptName, runRepoScript, type LocalCommand } from "./run-script";

const LOCAL_COMMANDS: LocalCommand[] = ["prepare", "capture", "verify"];

function printHelp(): void {
  console.error(`PatchSync CLI

Usage:
  patchsync local <command> [args]

Local commands:
  prepare [config] [patch_name]
  capture <patch_name> [config]
  verify [config]

Examples:
  patchsync local prepare patchsync.config.json patch_2
  patchsync local capture patch_2 patchsync.config.json
  patchsync local verify patchsync.config.json
`);
}

function parseLocalCommand(value: string | undefined): LocalCommand | null {
  if (!value) {
    return null;
  }

  return LOCAL_COMMANDS.includes(value as LocalCommand) ? (value as LocalCommand) : null;
}

async function main(): Promise<void> {
  const [scope, commandName, ...args] = process.argv.slice(2);

  if (!scope || scope === "--help" || scope === "-h" || scope === "help") {
    printHelp();
    process.exit(scope ? 0 : 1);
  }

  if (scope !== "local") {
    console.error(`Unknown PatchSync scope: ${scope}`);
    printHelp();
    process.exit(1);
  }

  const command = parseLocalCommand(commandName);
  if (!command) {
    console.error(`Unknown local command: ${commandName ?? "(missing)"}`);
    printHelp();
    process.exit(1);
  }

  const code = await runRepoScript(getLocalScriptName(command), args);
  process.exit(code);
}

await main();
