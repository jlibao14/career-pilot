import { logger } from "./logger";

const AGENTMAIL_BASE = "https://api.agentmail.to/v0";
export const SENDER_INBOX = "jlibao@agentmail.to";

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  attachments?: Array<{
    filename: string;
    content: string; // base64
    contentType: string;
  }>;
}

export interface SendEmailResult {
  messageId: string | null;
  raw: unknown;
}

export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    throw new Error("AGENTMAIL_API_KEY is not set");
  }

  const body: Record<string, unknown> = {
    to: [opts.to],
    subject: opts.subject,
    text: opts.text,
    html: textToHtml(opts.text),
  };

  if (opts.attachments && opts.attachments.length > 0) {
    body.attachments = opts.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      content_type: a.contentType,
    }));
  }

  const url = `${AGENTMAIL_BASE}/inboxes/${encodeURIComponent(SENDER_INBOX)}/messages/send`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseText = await res.text();
  let parsed: unknown = null;
  try {
    parsed = responseText ? JSON.parse(responseText) : null;
  } catch {
    parsed = responseText;
  }

  if (!res.ok) {
    logger.error({ status: res.status, body: parsed }, "AgentMail send failed");
    const message =
      typeof parsed === "object" && parsed && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : `AgentMail responded ${res.status}`;
    throw new Error(message);
  }

  const messageId = extractMessageId(parsed);
  return { messageId, raw: parsed };
}

function extractMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  for (const key of ["message_id", "id", "messageId"]) {
    const v = p[key];
    if (typeof v === "string") return v;
  }
  return null;
}

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paragraphs = escaped
    .split(/\n\s*\n/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
  return `<div style="font-family: Georgia, 'Times New Roman', serif; font-size: 15px; line-height: 1.6; color: #1a1a1a;">${paragraphs}</div>`;
}
