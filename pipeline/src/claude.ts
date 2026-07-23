import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-8";
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from root .env (bun auto-loads it)

/** One schema-constrained Claude call → parsed JSON. LLM judges once; everything downstream is deterministic. */
export async function claudeJson<T>(opts: {
  system?: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    thinking: { type: "adaptive" },
    system: opts.system,
    output_config: { format: { type: "json_schema", schema: opts.schema } },
    messages: [{ role: "user", content: opts.prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude refused the request");
  if (response.stop_reason === "max_tokens") throw new Error("Output truncated (max_tokens) — raise maxTokens");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No text block in response");
  return JSON.parse(text.text) as T;
}
