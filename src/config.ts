import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const nonEmptyString = z.string().min(1);

const dependenciesSchema = z
  .object({
    install: z
      .object({
        enabled: z.boolean().default(false),
        command: nonEmptyString,
      })
      .optional(),
  })
  .prefault({});

const releaseSchema = z
  .object({
    enabled: z.boolean().default(false),
    when: z
      .enum([
        "every_upstream_nightly",
        "every_upstream_commit",
        "every_upstream_release",
      ])
      .default("every_upstream_commit"),
    prereleaseSource: z.enum(["ignore", "include", "only"]).default("ignore"),
    buildCommand: z.string().optional(),
    artifacts: z.array(z.string()).default([]),
  })
  .prefault({});

const agentSchema = z.object({
  enabled: z.boolean().default(true),
  provider: nonEmptyString.default("codex"),
  model: z.string().optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  mode: z.enum(["session", "exec"]).default("exec"),
  timeoutMinutes: z.number().int().positive().default(30),
  acpxVersion: nonEmptyString.default("latest"),
  install: z
    .object({
      enabled: z.boolean().default(true),
      command: z.string().optional(),
    })
    .prefault({}),
  createIssueOnBreakingChange: z.boolean().default(true),
  breakingChange: z
    .object({
      enabled: z.boolean().default(true),
      createIssue: z.boolean().default(true),
      failWorkflow: z.boolean().default(true),
      markerFiles: z.array(z.string()).default(["BREAKING_CHANGE.md"]),
      labels: z.array(z.string()).default(["patchsync", "breaking-change"]),
    })
    .prefault({}),
  onlyModify: z
    .array(z.string())
    .default([
      "patches/**",
      "patchsync.config.json",
      "LATEST_SUPPORTED_COMMIT",
    ]),
});

export const configSchema = z.object({
  target: z.object({
    repo: nonEmptyString,
    ref: nonEmptyString.default("main"),
  }),
  patches: z.object({
    dir: nonEmptyString.default("patches"),
    latestSupportedCommitFile: nonEmptyString.default(
      "LATEST_SUPPORTED_COMMIT",
    ),
  }),
  verify: z.object({
    baseline: z.string().optional(),
    patched: nonEmptyString,
    allowSameBaselineFailure: z.boolean().default(true),
  }),
  dependencies: dependenciesSchema,
  release: releaseSchema,
  agent: agentSchema.prefault({}),
  pullRequest: z
    .object({
      enabled: z.boolean().default(true),
      branchPrefix: nonEmptyString.default("patchsync/"),
      title: nonEmptyString.default("chore: update patch stack"),
      labels: z.array(z.string()).default(["patchsync"]),
    })
    .prefault({}),
});

export type PatchSyncConfig = z.infer<typeof configSchema>;

export async function loadConfig(options: {
  path: string;
  repoRoot: string;
}): Promise<PatchSyncConfig> {
  const raw = await readFile(resolve(options.repoRoot, options.path), "utf8");
  const parsed = JSON.parse(raw);
  const result = configSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Invalid PatchSync config:\n${z.prettifyError(result.error)}`,
    );
  }

  return result.data;
}
