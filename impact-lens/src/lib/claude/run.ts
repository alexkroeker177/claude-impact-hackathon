import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import * as z from "zod";

const DEFAULT_BUDGET_USD = 1;
const MAX_BUDGET_USD = 5;
const DEFAULT_MAX_TURNS = 5;
const MAX_MAX_TURNS = 8;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 180_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_STDOUT_BYTES = 1_000_000;
const MAX_STDERR_BYTES = 128_000;
const MAX_PACKET_BYTES = 2_000_000;
const KILL_GRACE_MS = 1_500;

export type ClaudeRunErrorCode =
  | "CLI_NOT_FOUND"
  | "AUTHENTICATION"
  | "TIMEOUT"
  | "BUDGET"
  | "NON_ZERO_EXIT"
  | "INVALID_OUTPUT";

export class ClaudeRunError extends Error {
  readonly code: ClaudeRunErrorCode;
  readonly retryable: boolean;
  readonly causeDetail?: string;

  constructor(
    code: ClaudeRunErrorCode,
    message: string,
    options: { retryable: boolean; causeDetail?: string } = { retryable: true },
  ) {
    super(message);
    this.name = "ClaudeRunError";
    this.code = code;
    this.retryable = options.retryable;
    this.causeDetail = options.causeDetail;
  }
}

export type RunClaudeStructuredInput<T> = {
  /** Static instructions. User and upload data belongs only in analysisInput. */
  prompt: string;
  schema: z.ZodType<T>;
  /** A compact, redacted packet. This is the only file Claude can read. */
  analysisInput: unknown;
};

function parseConfiguredPositiveNumber(value: string | undefined, fallback: number, maximum: number): number {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, maximum);
}

function configuredBudget(): string {
  return parseConfiguredPositiveNumber(
    process.env.CLAUDE_MAX_BUDGET_USD,
    DEFAULT_BUDGET_USD,
    MAX_BUDGET_USD,
  ).toFixed(2);
}

function configuredTimeout(): number {
  const timeout = parseConfiguredPositiveNumber(
    process.env.CLAUDE_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  return Math.max(MIN_TIMEOUT_MS, timeout);
}

function configuredMaxTurns(): string {
  return Math.floor(parseConfiguredPositiveNumber(
    process.env.CLAUDE_MAX_TURNS,
    DEFAULT_MAX_TURNS,
    MAX_MAX_TURNS,
  )).toString();
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

function pathEnvironment(): string | undefined {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path");
  return pathKey ? process.env[pathKey] : undefined;
}

async function findExecutableOnPath(): Promise<string | undefined> {
  const executableNames = process.platform === "win32" ? ["claude.exe", "claude"] : ["claude"];
  for (const directory of (pathEnvironment() ?? "").split(delimiter)) {
    if (!directory) continue;
    for (const executableName of executableNames) {
      const candidate = join(directory, executableName);
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export async function resolveClaudeExecutable(): Promise<string> {
  const configuredPath = process.env.CLAUDE_PATH?.trim();
  if (configuredPath && (await isExecutable(configuredPath))) {
    return configuredPath;
  }

  const fromPath = await findExecutableOnPath();
  if (fromPath) {
    return fromPath;
  }

  const fallback = join(
    homedir(),
    ".local",
    "bin",
    process.platform === "win32" ? "claude.exe" : "claude",
  );
  if (await isExecutable(fallback)) {
    return fallback;
  }

  throw new ClaudeRunError(
    "CLI_NOT_FOUND",
    "Claude Code was not found. Set CLAUDE_PATH or install the Claude Code CLI.",
    { retryable: false, causeDetail: configuredPath ? `CLAUDE_PATH=${configuredPath}` : undefined },
  );
}

function scrubClaudeEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => {
      const normalizedKey = key.toUpperCase();
      return normalizedKey !== "CLAUDECODE" && !normalizedKey.startsWith("CLAUDE_CODE_");
    }),
  ) as NodeJS.ProcessEnv;
}

function classifyNonZeroExit(stderr: string, stdout: string): ClaudeRunError {
  const detail = `${stderr}\n${stdout}`.slice(0, 4_000);
  if (/auth(?:entication)?|log\s*in|sign\s*in|unauthori[sz]ed/i.test(detail)) {
    return new ClaudeRunError(
      "AUTHENTICATION",
      "Claude Code authentication is unavailable. Sign in with the local Claude Code installation and retry.",
      { retryable: true, causeDetail: detail },
    );
  }
  if (/budget|max[- ]?budget|cost limit|spend limit/i.test(detail)) {
    return new ClaudeRunError(
      "BUDGET",
      "Claude Code reached the configured analysis budget. Adjust CLAUDE_MAX_BUDGET_USD and retry.",
      { retryable: true, causeDetail: detail },
    );
  }
  return new ClaudeRunError("NON_ZERO_EXIT", "Claude Code did not complete the analysis.", {
    retryable: true,
    causeDetail: detail,
  });
}

function extractStructuredCandidate(envelope: unknown): unknown {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return envelope;
  }
  const record = envelope as Record<string, unknown>;
  const candidate = record.structured_output ?? record.structuredOutput ?? record.result ?? record.output;
  if (typeof candidate !== "string") {
    return candidate ?? envelope;
  }
  try {
    return JSON.parse(candidate);
  } catch {
    throw new ClaudeRunError("INVALID_OUTPUT", "Claude Code returned a non-JSON structured result.", {
      retryable: true,
      causeDetail: candidate.slice(0, 1_000),
    });
  }
}

/** Parses a Claude Code JSON envelope and applies the same Zod contract used at runtime. */
export function parseClaudeStructuredOutput<T>(stdout: string, schema: z.ZodType<T>): T {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new ClaudeRunError("INVALID_OUTPUT", "Claude Code returned invalid JSON output.", {
      retryable: true,
      causeDetail: stdout.slice(0, 1_000),
    });
  }

  const result = schema.safeParse(extractStructuredCandidate(envelope));
  if (!result.success) {
    throw new ClaudeRunError("INVALID_OUTPUT", "Claude Code returned output that does not match the semantic contract.", {
      retryable: true,
      causeDetail: result.error.issues.slice(0, 5).map((issue) => issue.message).join("; "),
    });
  }
  return result.data;
}

/** Claude Code validates Draft 7 keywords but rejects an unresolved meta-schema URI. */
export function claudeJsonSchema<T>(schema: z.ZodType<T>): unknown {
  const generated = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete generated.$schema;
  return generated;
}

function appendWithCap(
  current: Buffer,
  chunk: Buffer,
  cap: number,
): { value: Buffer; exceeded: boolean } {
  if (current.length + chunk.length > cap) {
    return { value: current, exceeded: true };
  }
  return { value: Buffer.concat([current, chunk]), exceeded: false };
}

async function runProcess(executable: string, args: string[], runDirectory: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout: Buffer = Buffer.alloc(0);
    let stderr: Buffer = Buffer.alloc(0);
    let settled = false;
    let terminationError: ClaudeRunError | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    // Assigned after the child process is created; settle() closes over it.
    // eslint-disable-next-line prefer-const
    let timeoutTimer: NodeJS.Timeout | undefined;

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (graceTimer) clearTimeout(graceTimer);
      callback();
    };

    let child;
    try {
      child = spawn(executable, args, {
        cwd: runDirectory,
        env: scrubClaudeEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      settle(() =>
        rejectPromise(
          new ClaudeRunError("CLI_NOT_FOUND", "Claude Code could not be started.", {
            retryable: false,
            causeDetail: detail,
          }),
        ),
      );
      return;
    }

    const terminate = (error: ClaudeRunError) => {
      if (terminationError) return;
      terminationError = error;
      child.kill("SIGTERM");
      graceTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    };

    child.stdout!.on("data", (chunk: Buffer) => {
      const captured = appendWithCap(stdout, Buffer.from(chunk), MAX_STDOUT_BYTES);
      stdout = captured.value;
      if (captured.exceeded) {
        terminate(
          new ClaudeRunError("INVALID_OUTPUT", "Claude Code output exceeded the safe size limit.", {
            retryable: true,
          }),
        );
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      const captured = appendWithCap(stderr, Buffer.from(chunk), MAX_STDERR_BYTES);
      stderr = captured.value;
      if (captured.exceeded) {
        terminate(
          new ClaudeRunError("INVALID_OUTPUT", "Claude Code diagnostic output exceeded the safe size limit.", {
            retryable: true,
          }),
        );
      }
    });
    child.once("error", (error) => {
      settle(() => {
        rejectPromise(
          new ClaudeRunError("CLI_NOT_FOUND", "Claude Code could not be started.", {
            retryable: false,
            causeDetail: error.message,
          }),
        );
      });
    });
    child.once("close", (code) => {
      settle(() => {
        if (terminationError) {
          rejectPromise(terminationError);
          return;
        }
        const stdoutText = stdout.toString("utf8");
        const stderrText = stderr.toString("utf8");
        if (code !== 0) {
          rejectPromise(classifyNonZeroExit(stderrText, stdoutText));
          return;
        }
        resolvePromise(stdoutText);
      });
    });
    timeoutTimer = setTimeout(() => {
      terminate(
        new ClaudeRunError("TIMEOUT", "Claude Code exceeded the analysis timeout.", {
          retryable: true,
        }),
      );
    }, configuredTimeout());
  });
}

export async function runClaudeStructured<T>(input: RunClaudeStructuredInput<T>): Promise<T> {
  // Keep each nested object on its own bounded line so Claude's line-oriented
  // Read tool can consume wide profiles without truncating one giant line.
  const serializedPacket = lineBoundedJson(input.analysisInput);
  if (serializedPacket === undefined) {
    throw new ClaudeRunError("INVALID_OUTPUT", "The analysis packet must be JSON serializable.", {
      retryable: false,
    });
  }
  if (Buffer.byteLength(serializedPacket, "utf8") > MAX_PACKET_BYTES) {
    throw new ClaudeRunError("INVALID_OUTPUT", "The redacted analysis packet exceeds the safe size limit.", {
      retryable: false,
    });
  }

  const runDirectory = resolve(process.cwd(), ".data", "runs", randomUUID());
  await mkdir(runDirectory, { recursive: true });
  const packetPath = join(runDirectory, "analysis-input.json");
  await writeFile(packetPath, serializedPacket, { encoding: "utf8", mode: 0o600 });

  const jsonSchema = claudeJsonSchema(input.schema);
  const args = [
    "-p",
    input.prompt,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(jsonSchema),
    "--max-turns",
    configuredMaxTurns(),
    "--max-budget-usd",
    configuredBudget(),
    "--tools",
    "Read",
    "--permission-mode",
    "dontAsk",
    "--safe-mode",
    "--no-session-persistence",
  ];
  if (process.env.CLAUDE_MODEL?.trim()) {
    args.push("--model", process.env.CLAUDE_MODEL.trim());
  }

  const executable = await resolveClaudeExecutable();
  const stdout = await runProcess(executable, args, runDirectory);
  return parseClaudeStructuredOutput(stdout, input.schema);
}

function lineBoundedJson(value: unknown): string | undefined {
  const compact = JSON.stringify(value);
  if (compact === undefined) return undefined;
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < compact.length; index += 1) {
    const character = compact[index];
    output += character;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    const previous = compact[index - 1];
    if (!inString && character === "," && (previous === "}" || previous === "]")) output += "\n";
  }
  return output;
}

/** Exposed for security-focused tests without leaking the complete process environment. */
export function claudeSubprocessEnvironment(): NodeJS.ProcessEnv {
  return scrubClaudeEnvironment();
}
