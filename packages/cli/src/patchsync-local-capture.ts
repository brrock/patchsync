import { runRepoScript } from "./run-script";

const code = await runRepoScript("patchsync-local-capture.sh", process.argv.slice(2));
process.exit(code);
