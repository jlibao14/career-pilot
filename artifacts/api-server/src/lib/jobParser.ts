import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { generateJSON } from "./anthropic";

export interface ParsedJob {
  company: string | null;
  roleTitle: string | null;
  location: string | null;
  recipientEmail: string | null;
  recipientName: string | null;
  jobSummary: string | null;
  keyRequirements: string[];
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 2_000_000;

function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (lower.startsWith("ff")) return true; // multicast
    // IPv4-mapped
    if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7));
    return false;
  }
  return false;
}

async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }
  const host = url.hostname;
  if (!host) throw new Error("URL is missing hostname");
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Refusing to fetch private/loopback address");
    return url;
  }
  const lowered = host.toLowerCase();
  if (lowered === "localhost" || lowered.endsWith(".localhost") || lowered.endsWith(".internal")) {
    throw new Error("Refusing to fetch internal hostname");
  }
  const addrs = await dnsLookup(host, { all: true });
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new Error("Hostname resolves to a private/loopback address");
    }
  }
  return url;
}

export async function fetchJobFromUrl(rawUrl: string): Promise<string> {
  let currentUrl = await assertSafeUrl(rawUrl);

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; CareerPilot/1.0; +https://replit.com)",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "manual",
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get("location");
      if (!loc) throw new Error(`Redirect with no Location header (${response.status})`);
      const next = new URL(loc, currentUrl);
      currentUrl = await assertSafeUrl(next.toString());
      continue;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch job URL (${response.status})`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      const html = await response.text();
      return stripHtml(html.slice(0, MAX_BYTES));
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return stripHtml(new TextDecoder("utf-8").decode(merged));
  }
  throw new Error("Too many redirects");
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18000);
}

export async function parseJob(jobText: string, sourceUrl?: string | null): Promise<ParsedJob> {
  const system =
    "You are an expert at extracting structured job posting metadata. Be precise. " +
    "Return null for any field you cannot determine with confidence. Never invent contact emails.";

  const user = `Extract structured information from this job posting${
    sourceUrl ? ` (source URL: ${sourceUrl})` : ""
  }.

JSON shape:
{
  "company": string | null,
  "roleTitle": string | null,
  "location": string | null,
  "recipientEmail": string | null,
  "recipientName": string | null,
  "jobSummary": string | null,
  "keyRequirements": string[]
}

Rules:
- Only set "recipientEmail" if you literally see an email address in the posting.
- Keep keyRequirements concise (no more than ~10 words each).

Job posting:
"""
${jobText.slice(0, 16000)}
"""`;

  const parsed = await generateJSON<Partial<ParsedJob>>({
    system,
    user,
    maxTokens: 1500,
  });

  return {
    company: parsed.company ?? null,
    roleTitle: parsed.roleTitle ?? null,
    location: parsed.location ?? null,
    recipientEmail: parsed.recipientEmail ?? null,
    recipientName: parsed.recipientName ?? null,
    jobSummary: parsed.jobSummary ?? null,
    keyRequirements: Array.isArray(parsed.keyRequirements)
      ? parsed.keyRequirements.filter((s): s is string => typeof s === "string").slice(0, 8)
      : [],
  };
}
