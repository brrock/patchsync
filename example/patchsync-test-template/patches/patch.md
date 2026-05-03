# Patch stack

This stack is meant to exercise PatchSync repair flow on a real public repo.

- `01-readme-marker` is a real patch that applies to `octocat/Spoon-Knife`
- `02-stale-readme-context` targets the real `README.md` too, but with stale context so it
  should fail and require repair
