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

// Acceptance bounds — must match the real Validation Gate in validator.ts.
const MIN_WORDS = 180;
const MAX_WORDS = 320;
const MIN_PARAS = 3;
const MAX_PARAS = 4;
const MIN_PARA_WORDS = 35;
const MAX_PARA_WORDS = 160;
const MAX_SUBJECT_LEN = 120;

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const SIGNOFF_LINE_RE = /^(best regards|kind regards|sincerely|regards|best|warm regards|thank you|thanks|respectfully|cordially)[,.\s]*$/i;

// A bare-name line: 1-5 words, no terminal punctuation, mostly Capitalized.
function looksLikeName(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length < 1 || words.length > 5) return false;
  const capCount = words.filter((w) => /^[A-Z][a-zA-Z'’-]*$/.test(w)).length;
  return capCount >= Math.ceil(words.length / 2);
}

// True iff a paragraph is purely a sign-off block: a sign-off phrase line,
// optionally followed by a name-like line. Generic "short paragraph" is NOT
// enough — that risks collapsing a real short body paragraph.
function isSignoffParagraph(p: string): boolean {
  const lines = p.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 2) return false;
  if (SIGNOFF_LINE_RE.test(lines[0]!)) {
    return lines.length === 1 || looksLikeName(lines[1]!);
  }
  // Single bare name on its own (paired with a previous sign-off paragraph).
  return lines.length === 1 && looksLikeName(lines[0]!);
}

// Collapse a trailing sign-off block (e.g. "Best regards," and the candidate
// name each emitted as their own paragraph) back into the prior paragraph.
// The model frequently does this even when prompted not to.
//
// Safety: never reduces paragraph count below MIN_PARAS, and only merges
// paragraphs that actually look like a sign-off / bare-name tail.
function collapseSignoffBlock(text: string): string {
  let paras = paragraphsOf(text);
  while (paras.length > MIN_PARAS) {
    const last = paras[paras.length - 1]!;
    if (!isSignoffParagraph(last)) break;
    const prev = paras[paras.length - 2]!;
    paras = paras.slice(0, -2).concat([`${prev}\n${last}`]);
  }
  return paras.join("\n\n");
}

// If still over the paragraph limit, merge each short stub into a neighbour
// (preferring the previous paragraph) until the count is in range or no
// further mechanical merges are safe.
function mergeShortStubs(text: string): string {
  const STUB_THRESHOLD = 20;
  let paras = paragraphsOf(text);
  while (paras.length > MAX_PARAS) {
    const counts = paras.map(wordCount);
    // Find the smallest paragraph below the stub threshold.
    let idx = -1;
    let smallest = Infinity;
    for (let i = 0; i < paras.length; i++) {
      const c = counts[i]!;
      if (c < STUB_THRESHOLD && c < smallest) {
        smallest = c;
        idx = i;
      }
    }
    if (idx === -1) break;
    // Merge into previous if possible, otherwise into next.
    if (idx > 0) {
      paras = [
        ...paras.slice(0, idx - 1),
        `${paras[idx - 1]} ${paras[idx]}`,
        ...paras.slice(idx + 1),
      ];
    } else {
      paras = [
        `${paras[0]} ${paras[1]}`,
        ...paras.slice(2),
      ];
    }
  }
  return paras.join("\n\n");
}

export function normalizeLetter(text: string): string {
  return mergeShortStubs(collapseSignoffBlock(text));
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
  if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) {
    issues.push(`Rewrite is ${wordCount} words (need ${MIN_WORDS}-${MAX_WORDS}).`);
  }
  const paras = paragraphsOf(coverLetter);
  if (paras.length < MIN_PARAS || paras.length > MAX_PARAS) {
    issues.push(`Rewrite has ${paras.length} paragraphs (need ${MIN_PARAS}-${MAX_PARAS}).`);
  } else {
    const counts = paras.map((p) => p.split(/\s+/).filter(Boolean).length);
    const tooShort = counts.find((c) => c < MIN_PARA_WORDS);
    const tooLong = counts.find((c) => c > MAX_PARA_WORDS);
    if (tooShort !== undefined) issues.push(`Paragraph too short (${tooShort} words).`);
    if (tooLong !== undefined) issues.push(`Paragraph too long (${tooLong} words).`);
  }
  if (PLACEHOLDER_RE.test(coverLetter)) {
    issues.push("Rewrite still contains a placeholder token.");
  }
  const subj = emailSubject.trim();
  if (subj.length === 0) issues.push("Subject is empty.");
  if (subj.length > MAX_SUBJECT_LEN) issues.push(`Subject exceeds ${MAX_SUBJECT_LEN} chars.`);
  if (PLACEHOLDER_RE.test(subj)) issues.push("Subject contains a placeholder.");
  return { ok: issues.length === 0, issues };
}

function buildSystemPrompt(): string {
  return `You are a senior career strategist revising an existing executive-tone cover letter.

Rules:
- Output a fully rewritten letter that fixes the listed validation failures while preserving the candidate's voice and the concrete facts (companies, metrics, dates, names) from the original. Never invent new metrics or employers.
- Aim for 220-260 words, in 3 paragraphs separated by a single blank line. The rewrite MUST be between ${MIN_WORDS} and ${MAX_WORDS} words and have ${MIN_PARAS} or ${MAX_PARAS} paragraphs total. Each paragraph must be ${MIN_PARA_WORDS}-${MAX_PARA_WORDS} words.
- Paragraph 1: hook tying the candidate's strongest credential to the role.
- Paragraph 2: 2-3 concrete, quantified proof points relevant to the posting (you may split this across two paragraphs if it reads better, giving 4 paragraphs total).
- Final paragraph: forward-looking close + clear next step.
- No buzzwords, no clichés, no exclamation marks.
- Replace any placeholder tokens like [Company], [Role], {{name}}, TBD, INSERT_X with concrete values from the job + profile context. If the recipient name is unknown, open with "Dear Hiring Team,".
- Sign off with "Best regards," followed by the candidate's full name on a new line. The sign-off and name belong to the final paragraph block — do NOT split them onto a separate paragraph (a blank line before "Best regards," would create an extra paragraph and fail validation).
- Subject: ≤${MAX_SUBJECT_LEN} chars, format "Application: <Role> — <Candidate Name>", no placeholders.
- Plain prose only — no markdown, bullets, or headings.`;
}

function buildUserPrompt(input: AutoCorrectInput, targeted: string[], retryFeedback?: string[]): string {
  const retryBlock = retryFeedback && retryFeedback.length > 0
    ? `\n\nYour previous attempt failed these structural checks — fix them this time:\n${retryFeedback.map((i) => `- ${i}`).join("\n")}`
    : "";

  return `Candidate:
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

Failed checks to fix: ${targeted.join(", ") || "(none)"}${retryBlock}

Return JSON of the form:
{
  "coverLetter": "<full rewritten letter as plain prose with paragraphs separated by a blank line>",
  "emailSubject": "<rewritten subject line>",
  "summary": ["<short past-tense bullet describing one change>", "..."]
}

The "summary" should be 2-5 short bullets in plain English (e.g. "Tightened opening paragraph to 52 words", "Replaced [Hiring Manager] placeholder with Hiring Team", "Fixed 2 grammar issues"). Only describe what you actually changed.`;
}

async function callLLM(system: string, user: string): Promise<{ coverLetter: string; emailSubject: string; summary: string[] }> {
  const result = await generateJSON<{
    coverLetter?: string;
    emailSubject?: string;
    summary?: unknown;
  }>({ system, user, maxTokens: 2000 });

  const rawLetter = (result.coverLetter ?? "").trim();
  return {
    coverLetter: normalizeLetter(rawLetter),
    emailSubject: (result.emailSubject ?? "").trim(),
    summary: Array.isArray(result.summary)
      ? result.summary.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : [],
  };
}

export interface AutoCorrectAttemptOutcome {
  result: AutoCorrectResult;
  validation: AutoCorrectValidation;
}

const MAX_RETRIES = 2;

export async function autoCorrectLetter(input: AutoCorrectInput): Promise<AutoCorrectAttemptOutcome> {
  const targeted = input.failedCheckIds.filter((id) =>
    (AUTO_CORRECTABLE_CHECK_IDS as readonly string[]).includes(id),
  );

  const system = buildSystemPrompt();

  let attempt = await callLLM(system, buildUserPrompt(input, targeted));
  let validation = validateAutoCorrectOutput(attempt.coverLetter, attempt.emailSubject);

  for (let i = 0; i < MAX_RETRIES && !validation.ok; i++) {
    attempt = await callLLM(system, buildUserPrompt(input, targeted, validation.issues));
    validation = validateAutoCorrectOutput(attempt.coverLetter, attempt.emailSubject);
  }

  return {
    result: {
      coverLetter: attempt.coverLetter,
      emailSubject: attempt.emailSubject,
      summary: attempt.summary,
      targetedCheckIds: targeted,
    },
    validation,
  };
}
