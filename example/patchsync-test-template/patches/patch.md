# Patch stack

This stack is meant to exercise PatchSync repair flow on a real public repo.

- `patch_1` is a real patch that applies to `octocat/Spoon-Knife`
- `patch_2` targets the real `README.md` too, but with stale context so it
  should fail and require repair
