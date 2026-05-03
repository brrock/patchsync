# patchsync-test

Example repo for exercising PatchSync against `octocat/Spoon-Knife`.

This repo contains one PatchSync config and one patch stack:

- `01-readme-marker` applies cleanly to `README.md`
- `02-stale-readme-context` also targets the real upstream `README.md`, but uses stale context so
  `git apply` should fail and force PatchSync into repair flow
