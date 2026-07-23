import { spawn } from "node:child_process";

import Anthropic from "@anthropic-ai/sdk";

export type ClaudeRunErrorKind = "auth" | "timeout" | "invalid_output" | "api_error";

export class ClaudeRunError extends Error {
  readonly kind: ClaudeRunErrorKind;

  constructor(kind: ClaudeRunErrorKind, message: string) {
    super(message);
    this.name = "ClaudeRunError";
    this.kind = kind;
  }
}

export interface RunClaudeStructuredOptions<T> {
  system: string;
  prompt: string;
  jsonSchema: object;
  validate: (raw: unknown) => T;
  maxTokens?: number;
}

function timeoutMs(): number {
  const parsed = Number(process.env.CLAUDE_TIMEOUT_MS || "120000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120000;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Strip markdown fences / surrounding prose so a JSON object embedded in text still parses. */
function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

/**
 * Parse a raw model text output as JSON and run the caller's validator.
 * Exported separately so tests can exercise extraction without a live API call.
 */
export function parseStructuredText<T>(text: string, validate: (raw: unknown) => T): T {
  let raw: unknown;
  try {
    raw = JSON.parse(extractJson(text));
  } catch (err) {
    throw new ClaudeRunError("invalid_output", `Model returned non-JSON output: ${errMessage(err)}`);
  }
  try {
    return validate(raw);
  } catch (err) {
    throw new ClaudeRunError("invalid_output", `Model output failed validation: ${errMessage(err)}`);
  }
}

/**
 * NOTE: we deliberately do NOT use the API's strict json_schema output format.
 * The SemanticPlan schema compiles to a grammar above the API's size limit
 * ("The compiled grammar is too large"). Instead the schema is embedded in the
 * system prompt and the response is validated locally with zod — with one
 * self-correcting retry that feeds the validation error back to the model.
 */
async function runViaSdk<T>(opts: RunClaudeStructuredOptions<T>, feedback?: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const client = new Anthropic();
    const system = `${opts.system}

Respond with ONLY a single JSON object — no markdown fences, no commentary before or after. The object must validate against this JSON Schema:
${JSON.stringify(opts.jsonSchema)}`;
    const prompt = feedback
      ? `${opts.prompt}

Your previous response failed validation: ${feedback}
Return the corrected JSON object only.`
      : opts.prompt;
    const response = await client.messages
      .stream(
        {
          model: process.env.CLAUDE_MODEL || "claude-opus-4-8",
          max_tokens: opts.maxTokens ?? 16000,
          thinking: { type: "adaptive" },
          system,
          messages: [{ role: "user", content: prompt }],
        },
        { signal: controller.signal },
      )
      .finalMessage();

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new ClaudeRunError("invalid_output", "Model response contained no text content block.");
    }
    return parseStructuredText(textBlock.text, opts.validate);
  } catch (err) {
    if (err instanceof ClaudeRunError) throw err;
    if (controller.signal.aborted) {
      throw new ClaudeRunError("timeout", `Claude request timed out after ${timeoutMs()}ms.`);
    }
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new ClaudeRunError("auth", `Claude authentication failed: ${errMessage(err)}`);
    }
    throw new ClaudeRunError("api_error", `Claude API error: ${errMessage(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

function buildCliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    // CRITICAL: the CLI refuses to run nested inside a Claude Code session
    // unless these markers are stripped from the environment.
    if (key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_")) {
      delete env[key];
    }
  }
  return env;
}

async function runViaCli<T>(opts: RunClaudeStructuredOptions<T>): Promise<T> {
  const executable = process.env.CLAUDE_PATH || "claude";
  const args = [
    "-p",
    opts.prompt,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(opts.jsonSchema),
    "--max-turns",
    "3",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
  ];

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: buildCliEnv(),
    });

    let out = "";
    let errOut = "";
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
      settled = true;
      reject(new ClaudeRunError("timeout", `Claude CLI timed out after ${timeoutMs()}ms.`));
    }, timeoutMs());

    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errOut += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ClaudeRunError("api_error", `Failed to spawn Claude CLI (${executable}): ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        const kind: ClaudeRunErrorKind = /auth|login|api key/i.test(errOut) ? "auth" : "api_error";
        reject(new ClaudeRunError(kind, `Claude CLI exited with code ${code}: ${errOut.slice(0, 500)}`));
        return;
      }
      resolve(out);
    });
  });

  // The CLI wraps output as {"type":"result","result":...} — extract the structured result.
  let wrapper: unknown;
  try {
    wrapper = JSON.parse(stdout);
  } catch (err) {
    throw new ClaudeRunError("invalid_output", `Claude CLI produced non-JSON stdout: ${errMessage(err)}`);
  }
  const result = (wrapper as { result?: unknown }).result ?? wrapper;
  if (typeof result === "string") {
    return parseStructuredText(result, opts.validate);
  }
  try {
    return opts.validate(result);
  } catch (err) {
    throw new ClaudeRunError("invalid_output", `Claude CLI output failed validation: ${errMessage(err)}`);
  }
}

export async function runClaudeStructured<T>(opts: RunClaudeStructuredOptions<T>): Promise<T> {
  if (process.env.CLAUDE_TRANSPORT === "cli") {
    return runViaCli(opts);
  }
  try {
    return await runViaSdk(opts);
  } catch (err) {
    if (err instanceof ClaudeRunError && err.kind === "invalid_output") {
      return runViaSdk(opts, err.message);
    }
    throw err;
  }
}
