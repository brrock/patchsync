export type AcpxEvent = Record<string, unknown> & {
  type?: string;
};

export type AcpxRunSummary = {
  eventCount: number;
  eventTypes: Record<string, number>;
  finalAssistantText: string;
  toolCalls: Array<{
    title: string;
    status: string;
  }>;
  errors: string[];
};

export function parseAcpxJsonLines(stdout: string): {
  events: AcpxEvent[];
  summary: AcpxRunSummary;
} {
  const events: AcpxEvent[] = [];
  const summary: AcpxRunSummary = {
    eventCount: 0,
    eventTypes: {},
    finalAssistantText: "",
    toolCalls: [],
    errors: [],
  };

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    try {
      const event = JSON.parse(line) as AcpxEvent;
      events.push(event);

      const type = typeof event.type === "string" ? event.type : "unknown";
      summary.eventTypes[type] = (summary.eventTypes[type] ?? 0) + 1;

      if (type === "assistant_message") {
        const text = getString(event, ["text", "content", "message"]);
        if (text) {
          summary.finalAssistantText = text;
        }
      }

      if (type === "tool_call") {
        summary.toolCalls.push({
          title: getString(event, ["title", "toolName", "tool_name"]) || "tool",
          status: getString(event, ["status"]) || "unknown",
        });
      }

      if (type === "error" || type === "agent_error" || type === "tool_error") {
        const errorMessage =
          getString(event, ["message", "text", "error"]) ||
          JSON.stringify(event);
        summary.errors.push(errorMessage);
      }
    } catch (error) {
      summary.errors.push(
        `Failed to parse ACPX JSON line: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  summary.eventCount = events.length;
  return { events, summary };
}

function getString(
  event: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = event[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}
