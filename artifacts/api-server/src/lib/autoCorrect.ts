import { generateJSON } from "./anthropic";
import type { Profile } from "@workspace/db";

export interface AutoCorrectInput {
  profile: Profile;
  coverLetter: string;
  emailSubject: string | null;
  company: string | null;
  roleTitle: string | null;
  recipientName: string | null;
  jobSummary: string | null;
  keyRequirements: string[];
  failedCheckIds: string[];
}

export interface AutoCorrectResult {
  coverLetter: string;
  emailSubject: string;
  summary: string[];
  targetedCheckIds: string[];
}

export const AUTO_CORRECTABLE_CHECK_IDS = [
  "word_count",
  "paragraph_structure",
  "no_placeholders",
  "subject_present",
  "grammar_spelling",
] as const;

const PLACEHOLDER_RE = /\[[^\]]+\]|\bTBD\b|INSERT_|\{\{[^}]+\}\}/i;

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export interface AutoCorrectValidation {
  ok: boolean;
  issues: string[];
}

export function validateAutoCorrectOutput(
  coverLetter: string,
  emailSubject: string,
): AutoCorrectValidation {
  const issues: string[] = [];
  const wordCount = coverLetter.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 200 || wordCount > 280) {
    issues.push(`Rewrite is ${wordCount} words (need 200-280).`);
  }
  const paras = paragraphsOf(coverLetter);
  if (paras.length !== 3) {
    issues.push(`Rewrite has ${paras.length} paragraphs (need exactly 3).`);
  } else {
    const counts = paras.map((p) => p.split(/\s+/).filter(Boolean).length);
    const tooShort = counts.find((c) => c < 35);
    const tooLong = counts.find((c) => c > 160);
    if (tooShort !== undefined) issues.push(`Paragraph too short (${tooShort} words).`);
    if (tooLong !== undefined) issues.push(`Paragraph too long (${tooLong} words).`);
  }
  if (PLACEHOLDER_RE.test(coverLetter)) {
    issues.push("Rewrite still contains a placeholder token.");
  }
  const subj = emailSubject.trim();
  if (subj.length === 0) issues.push("Subject is empty.");
  if (subj.length > 120) issues.push("Subject exceeds 120 chars.");
  if (PLACEHOLDER_RE.test(subj)) issues.push("Subject contains a placeholder.");
  return { ok: issues.length === 0, issues };
}

export async function autoCorrectLetter(input: AutoCorrectInput): Promise<AutoCorrectResult> {
  const targeted = input.failedCheckIds.filter((id) =>
    (AUTO_CORRECTABLE_CHECK_IDS as readonly string[]).includes(id),
  );

  const system = `You are a senior career strategist revising an existing executive-tone cover letter.

Rules:
- Output a fully rewritten letter that fixes the listed validation failures while preserving the candidate's voice and the concrete facts (companies, metrics, dates, names) from the original. Never invent new metrics or employers.
- Length: exactly 200-280 words, exactly 3 paragraphs separated by a single blank line. Each paragraph 35-160 words.
- Paragraph 1: hook tying the candidate's strongest credential to the role.
- Paragraph 2: 2-3 concrete, quantified proof points relevant to the posting.
- Paragraph 3: forward-looking close + clear next step.
- No buzzwords, no clichés, no exclamation marks.
- Replace any placeholder tokens like [Company], [Role], {{name}}, TBD, INSERT_X with concrete values from the job + profile context. If the recipient name is unknown, open with "Dear Hiring Team,".
- Sign off with "Best regards," followed by the candidate's full name on a new line.
- Subject: ≤120 chars, format "Application: <Role> — <Candidate Name>", no placeholders.
- Plain prose only — no markdown, bullets, or headings.`;

  const user = `Candidate:
- Name: ${input.profile.fullName || "(unknown)"}
- Headline: ${input.profile.headline ?? "(none)"}
- Preferred tone: ${input.profile.preferredTone ?? "(default executive)"}
- Key achievements (use verbatim where relevant; never invent):
${
  input.profile.keyAchievements
    ? input.profile.keyAchievements
        .split("\n")
        .map((l) => `  - ${l.trim()}`)
        .filter((l) => l.length > 4)
        .join("\n")
    : "  - (none provided)"
}

Job:
- Company: ${input.company ?? "(unknown)"}
- Role: ${input.roleTitle ?? "(unknown)"}
- Recipient name: ${input.recipientName ?? "(unknown)"}
- Summary: ${input.jobSummary ?? "(none)"}
- Key requirements:
${input.keyRequirements.map((r) => `  - ${r}`).join("\n") || "  - (none)"}

Current subject: ${input.emailSubject ?? "(none)"}

Current letter:
"""
${input.coverLetter}
"""

Failed checks to fix: ${targeted.join(", ") || "(none)"}

Return JSON of the form:
{
  "coverLetter": "<full rewritten letter as plain prose with paragraphs separated by a blank line>",
  "emailSubject": "<rewritten subject line>",
  "summary": ["<short past-tense bullet describing one change>", "..."]
}

The "summary" should be 2-5 short bullets in plain English (e.g. "Tightened opening paragraph to 52 words", "Replaced [Hiring Manager] placeholder with Hiring Team", "Fixed 2 grammar issues"). Only describe what you actually changed.`;

  const result = await generateJSON<{
    coverLetter?: string;
    emailSubject?: string;
    summary?: unknown;
  }>({ system, user, maxTokens: 2000 });

  const coverLetter = (result.coverLetter ?? "").trim();
  const emailSubject = (result.emailSubject ?? "").trim();
  const summary = Array.isArray(result.summary)
    ? result.summary.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];

  return {
    coverLetter,
    emailSubject,
    summary,
    targetedCheckIds: targeted,
  };
}
