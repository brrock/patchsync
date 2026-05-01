export type CommandResult = {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
};

export async function runCommand(options: {
  command: string;
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  inherit?: boolean;
}): Promise<CommandResult> {
  const controller = new AbortController();
  const timeout =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const result = Bun.spawn(["bash", "-lc", options.command], {
      cwd: options.cwd,
      stdout: options.inherit ? "inherit" : "pipe",
      stderr: options.inherit ? "inherit" : "pipe",
      env: options.env,
      signal: controller.signal,
    });

    const [stdout, stderr, code] = await Promise.all([
      options.inherit || result.stdout === null
        ? Promise.resolve("")
        : new Response(result.stdout).text(),
      options.inherit || result.stderr === null
        ? Promise.resolve("")
        : new Response(result.stderr).text(),
      result.exited,
    ]);

    return {
      ok: code === 0,
      code,
      stdout,
      stderr,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        code: 124,
        stdout: "",
        stderr: "Command timed out",
      };
    }

    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
