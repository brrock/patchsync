export type AcpxEvent = Record<string, unknown>;

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

      const bucket = classifyEvent(event);
      summary.eventTypes[bucket] = (summary.eventTypes[bucket] ?? 0) + 1;

      const assistantText = extractAssistantText(event);
      if (assistantText) {
        summary.finalAssistantText += assistantText;
      }

      const toolCall = extractToolCall(event);
      if (toolCall) {
        summary.toolCalls.push(toolCall);
      }

      const errorMessage = extractError(event);
      if (errorMessage) {
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

function classifyEvent(event: Record<string, unknown>) {
  const method = typeof event.method === "string" ? event.method : undefined;
  if (method === "session/update") {
    const sessionUpdate = getNestedString(event, ["params", "sessionUpdate"]);
    if (sessionUpdate) {
      return `session/update:${sessionUpdate}`;
    }
    const nestedUpdate = getNestedString(event, [
      "params",
      "update",
      "sessionUpdate",
    ]);
    if (nestedUpdate) {
      return `session/update:${nestedUpdate}`;
    }
    return "session/update";
  }

  if (method) {
    return method;
  }

  const stopReason = getNestedString(event, ["result", "stopReason"]);
  if (stopReason) {
    return `result:${stopReason}`;
  }

  if (Object.hasOwn(event, "error")) {
    return "error";
  }

  return "unknown";
}

function extractAssistantText(event: Record<string, unknown>) {
  const method = typeof event.method === "string" ? event.method : undefined;
  if (method !== "session/update") {
    return "";
  }

  const text =
    getNestedString(event, ["params", "content", "text"]) ??
    getNestedString(event, ["params", "update", "content", "text"]);

  return text ?? "";
}

function extractToolCall(event: Record<string, unknown>) {
  const method = typeof event.method === "string" ? event.method : undefined;
  if (method !== "session/update") {
    return null;
  }

  const sessionUpdate =
    getNestedString(event, ["params", "sessionUpdate"]) ??
    getNestedString(event, ["params", "update", "sessionUpdate"]);

  if (sessionUpdate !== "tool_call" && sessionUpdate !== "tool_call_update") {
    return null;
  }

  return {
    title:
      getNestedString(event, ["params", "title"]) ??
      getNestedString(event, ["params", "update", "title"]) ??
      "tool",
    status:
      getNestedString(event, ["params", "status"]) ??
      getNestedString(event, ["params", "update", "status"]) ??
      sessionUpdate,
  };
}

function extractError(event: Record<string, unknown>) {
  if (Object.hasOwn(event, "error")) {
    return (
      getNestedString(event, ["error", "message"]) ?? JSON.stringify(event)
    );
  }

  return undefined;
}

function getNestedString(
  root: Record<string, unknown>,
  path: string[],
): string | undefined {
  let current: unknown = root;

  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" && current.trim() ? current : undefined;
}
