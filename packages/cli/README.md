# `@brrock/patchsync`

CLI for PatchSync local patch maintenance.

This package exposes one binary:

```bash
patchsync
```

The CLI currently supports five local workflows:

- `patchsync init [root]`
- `patchsync order [config]`
- `patchsync prepare [config] [patch_name]`
- `patchsync prepare [patch_name]`
- `patchsync prepare [patch_order_number]`
- `patchsync capture <patch_name> [config]`
- `patchsync verify [config]`

## What It Does

`patchsync` is the local companion to the main PatchSync GitHub Action. It helps
you work on a patch stack from a clean upstream clone without manually invoking
repo maintenance entrypoints yourself.

- `init` scaffolds a new PatchSync layout and workflow files
- `order` scans the configured patch directory, sorts what it finds, and prints the exact patch application order
- `prepare` clones the configured upstream repo into `.patchsync-local/target`
  and applies patches in order
- `capture` turns your edits in `.patchsync-local/target` into a patch file under
  the configured patch directory
- `verify` runs the PatchSync action entrypoint in local check mode

## Requirements

- [Bun](https://bun.sh/)
- A PatchSync config file, typically `patchsync.config.json`
- A repo laid out for PatchSync patch maintenance

The CLI reads `target.repo`, `target.ref`, and `patches.dir` from the config
file, so it is meant to be run from a PatchSync-managed repository.

## Usage

Scaffold a new PatchSync repo:

```bash
patchsync init .
```

That creates `patchsync.config.json`, `LATEST_SUPPORTED_COMMIT`, the initial
`patches/` layout, and `.github/workflows/patchsync.yml` if they do not already
exist.

Show help:

```bash
patchsync --help
```

Prepare a scratch tree for one patch:

```bash
patchsync order patchsync.config.json
patchsync prepare 02-fix-build
```

Capture changes back into the patch stack:

```bash
patchsync capture 02-fix-build patchsync.config.json
```

Verify the full stack locally:

```bash
patchsync verify patchsync.config.json
```

## Typical Flow

```bash
patchsync order patchsync.config.json
patchsync prepare 02-fix-build
# edit files under .patchsync-local/target
patchsync capture 02-fix-build patchsync.config.json
patchsync verify patchsync.config.json
```

Use zero-padded numeric prefixes in patch directory names so the order stays obvious:

```text
patches/
  01-base-port/
  02-fix-build/
  03-add-feature-flag/
```

Patch entries stack on top of each other. PatchSync starts from clean upstream, applies the first entry, then applies the second entry on top of that result, and continues until the stack is complete.

`patchsync prepare` stops right before the selected patch. You can select it by name or by the order number shown by `patchsync order`:

```bash
patchsync prepare 02-fix-build
patchsync prepare 2
```

## Development

From the monorepo root:

```bash
bun install
bun run build:cli
```

From this package directory:

```bash
bun run build
```

The built entrypoint is:

```text
dist/main.js
```

For broader PatchSync setup, configuration, and GitHub Action behavior, see the
[repo root README](../../README.md).
