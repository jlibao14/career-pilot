import { anthropic } from "@workspace/integrations-anthropic-ai";

export const ANTHROPIC_MODEL = "claude-sonnet-4-6";

export async function generateText(opts: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });

  const textParts: string[] = [];
  for (const block of response.content) {
    if (block.type === "text") textParts.push(block.text);
  }
  return textParts.join("\n").trim();
}

export async function generateJSON<T = unknown>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<T> {
  const raw = await generateText({
    system: `${opts.system}\n\nRespond with ONLY valid JSON. No prose, no markdown fences, no commentary.`,
    user: opts.user,
    maxTokens: opts.maxTokens ?? 2048,
  });

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const jsonStr = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;

  return JSON.parse(jsonStr) as T;
}
