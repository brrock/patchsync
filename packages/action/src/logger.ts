import * as core from "@actions/core";

export type PatchSyncLogger = {
  appendSummary: (title: string, payload: unknown) => void;
};

const summarySections: Array<{ title: string; payload: unknown }> = [];

export async function createLogger(): Promise<PatchSyncLogger> {
  return {
    appendSummary(title, payload) {
      summarySections.push({ title, payload });
    },
  };
}

export async function flushSummary() {
  if (summarySections.length === 0) {
    return;
  }

  for (const section of summarySections) {
    core.summary.addHeading(section.title, 3);
    if (typeof section.payload === "string") {
      core.summary.addCodeBlock(section.payload, "text");
    } else {
      core.summary.addCodeBlock(
        JSON.stringify(section.payload, null, 2),
        "json",
      );
    }
  }

  await core.summary.write();
}
