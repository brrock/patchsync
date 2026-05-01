# patchsync-test

Example repo for exercising PatchSync against `octocat/Spoon-Knife`.

This repo contains one PatchSync config and one patch stack:

- `patch_1` applies cleanly to `README.md`
- `patch_2` also targets the real upstream `README.md`, but uses stale context so
  `git apply` should fail and force PatchSync into repair flow
