import { runLocalCommand, type LocalCommand } from "./run-command";

const LOCAL_COMMANDS: LocalCommand[] = ["init", "order", "prepare", "capture", "verify"];

function printHelp(): void {
  console.error(`PatchSync CLI

Usage:
  patchsync <command> [args]

Commands:
  init [root]
  order [config]
  prepare [config] [patch_name]
  prepare [patch_name]
  prepare [patch_order_number]
  capture <patch_name> [config]
  verify [config]

Examples:
  patchsync init .
  patchsync order patchsync.config.json
  patchsync prepare 02-fix-build
  patchsync prepare 2
  patchsync prepare patchsync.config.json 02-fix-build
  patchsync capture 02-fix-build patchsync.config.json
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

  const code = await runLocalCommand(command, args);
  process.exit(code);
}

await main();
