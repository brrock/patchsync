import { getLocalScriptName, runRepoScript, type LocalCommand } from "./run-script";

const LOCAL_COMMANDS: LocalCommand[] = ["prepare", "capture", "verify"];

function printHelp(): void {
  console.error(`PatchSync CLI

Usage:
  patchsync <command> [args]

Commands:
  prepare [config] [patch_name]
  capture <patch_name> [config]
  verify [config]

Examples:
  patchsync prepare patchsync.config.json patch_2
  patchsync capture patch_2 patchsync.config.json
  patchsync verify patchsync.config.json
`);
}

function parseLocalCommand(value: string | undefined): LocalCommand | null {
  if (!value) {
    return null;
  }

  return LOCAL_COMMANDS.includes(value as LocalCommand) ? (value as LocalCommand) : null;
}

async function main(): Promise<void> {
  const [commandName, ...args] = process.argv.slice(2);

  if (!commandName || commandName === "--help" || commandName === "-h" || commandName === "help") {
    printHelp();
    process.exit(commandName ? 0 : 1);
  }

  const command = parseLocalCommand(commandName);
  if (!command) {
    console.error(`Unknown PatchSync command: ${commandName}`);
    printHelp();
    process.exit(1);
  }

  const code = await runRepoScript(getLocalScriptName(command), args);
  process.exit(code);
}

await main();
