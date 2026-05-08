import { generateJSON } from "./anthropic";

export interface ValidationCheck {
  id: string;
  label: string;
  passed: boolean;
  detail?: string | null;
}

export interface ValidationReport {
  passed: boolean;
  checks: ValidationCheck[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_RE = /\[[^\]]+\]|\bTBD\b|INSERT_|\{\{[^}]+\}\}/i;
const SUSPECT_EMAIL_DOMAINS = new Set([
  "example.com", "example.org", "example.net",
  "test.com", "email.com", "domain.com",
  "yourcompany.com", "company.com",
]);

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export async function validateApplication(input: {
  coverLetter: string | null;
  emailSubject: string | null;
  recipientEmail: string | null;
  company: string | null;
  roleTitle: string | null;
  hasResume: boolean;
}): Promise<ValidationReport> {
  const checks: ValidationCheck[] = [];

  // 1. Cover letter present
  const letter = (input.coverLetter ?? "").trim();
  checks.push({
    id: "letter_present",
    label: "Cover letter drafted",
    passed: letter.length > 0,
    detail: letter.length > 0 ? null : "No cover letter has been drafted yet.",
  });

  // 2. Word count within executive bounds
  const wordCount = letter ? letter.split(/\s+/).filter(Boolean).length : 0;
  const wordCountOk = wordCount >= 180 && wordCount <= 320;
  checks.push({
    id: "word_count",
    label: "Length 180-320 words",
    passed: wordCountOk,
    detail: `${wordCount} words`,
  });

  // 3. Paragraph structure: 3 paragraphs, each within reasonable bounds
  const paragraphs = paragraphsOf(letter);
  let structureOk = false;
  let structureDetail: string | null = null;
  if (paragraphs.length === 0) {
    structureDetail = "No paragraphs found";
  } else if (paragraphs.length < 3 || paragraphs.length > 4) {
    structureDetail = `${paragraphs.length} paragraphs (expected 3, optionally 4)`;
  } else {
    const paraWordCounts = paragraphs.map((p) => p.split(/\s+/).filter(Boolean).length);
    const tooShort = paraWordCounts.find((c) => c < 35);
    const tooLong = paraWordCounts.find((c) => c > 160);
    if (tooShort !== undefined) {
      structureDetail = `One paragraph is too short (${tooShort} words)`;
    } else if (tooLong !== undefined) {
      structureDetail = `One paragraph is too long (${tooLong} words)`;
    } else {
      structureOk = true;
    }
  }
  checks.push({
    id: "paragraph_structure",
    label: "3 well-formed paragraphs",
    passed: structureOk,
    detail: structureDetail,
  });

  // 4. No placeholders
  const placeholderHit = PLACEHOLDER_RE.exec(letter);
  checks.push({
    id: "no_placeholders",
    label: "No placeholder tokens",
    passed: !placeholderHit,
    detail: placeholderHit ? `Contains "${placeholderHit[0]}"` : null,
  });

  // 5. Recipient email valid + plausible
  const email = (input.recipientEmail ?? "").trim().toLowerCase();
  let recipientOk = false;
  let recipientDetail: string | null = null;
  if (!email) {
    recipientDetail = "Missing recipient email";
  } else if (!EMAIL_RE.test(email)) {
    recipientDetail = `"${email}" is not a valid email`;
  } else {
    const domain = email.split("@")[1] ?? "";
    if (SUSPECT_EMAIL_DOMAINS.has(domain)) {
      recipientDetail = `"${domain}" looks like a placeholder domain`;
    } else if (domain.split(".").pop()!.length < 2) {
      recipientDetail = `"${domain}" has an invalid top-level domain`;
    } else {
      recipientOk = true;
      recipientDetail = email;
    }
  }
  checks.push({
    id: "recipient_email",
    label: "Valid recipient email",
    passed: recipientOk,
    detail: recipientDetail,
  });

  // 6. Company + role identified
  checks.push({
    id: "company_role",
    label: "Company and role identified",
    passed: !!(input.company && input.roleTitle),
    detail:
      !input.company && !input.roleTitle
        ? "Company and role missing"
        : !input.company
          ? "Company missing"
          : !input.roleTitle
            ? "Role missing"
            : null,
  });

  // 7. Subject present
  const subject = (input.emailSubject ?? "").trim();
  checks.push({
    id: "subject_present",
    label: "Email subject drafted",
    passed: subject.length > 0 && subject.length <= 120 && !PLACEHOLDER_RE.test(subject),
    detail:
      subject.length === 0
        ? "Subject missing"
        : subject.length > 120
          ? "Subject is too long"
          : PLACEHOLDER_RE.test(subject)
            ? "Subject contains a placeholder"
            : null,
  });

  // 8. Resume attached
  checks.push({
    id: "resume_attached",
    label: "Resume PDF attached",
    passed: input.hasResume,
    detail: input.hasResume ? null : "Upload a master resume in Settings",
  });

  // 9. Grammar / spelling via LLM (only if letter present)
  if (letter.length > 0) {
    try {
      const { passed, issue } = await llmGrammarCheck(letter);
      checks.push({
        id: "grammar_spelling",
        label: "Grammar and spelling",
        passed,
        detail: passed ? null : issue,
      });
    } catch {
      checks.push({
        id: "grammar_spelling",
        label: "Grammar and spelling",
        passed: false,
        detail: "Grammar check unavailable — please review manually before sending",
      });
    }
  } else {
    checks.push({
      id: "grammar_spelling",
      label: "Grammar and spelling",
      passed: false,
      detail: "No letter to check",
    });
  }

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}

async function llmGrammarCheck(letter: string): Promise<{ passed: boolean; issue: string | null }> {
  const result = await generateJSON<{ passed: boolean; issue: string | null }>({
    system:
      "You are a precise copy editor. Check for grammar errors, spelling errors, and awkward phrasing. " +
      "Only flag genuine issues, not stylistic preferences.",
    user: `Review this cover letter. Return JSON: { "passed": boolean, "issue": string | null }.
"passed" is true if there are no real grammar or spelling errors.
"issue" is a single short sentence describing the most important problem (or null).

Letter:
"""
${letter}
"""`,
    maxTokens: 400,
  });

  return {
    passed: !!result.passed,
    issue: typeof result.issue === "string" ? result.issue : null,
  };
}
