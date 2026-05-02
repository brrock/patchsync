import { runRepoScript } from "./run-script";

const code = await runRepoScript("patchsync-local-prepare.sh", process.argv.slice(2));
process.exit(code);
