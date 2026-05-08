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

  // 3. No placeholders
  const placeholderHit = PLACEHOLDER_RE.exec(letter);
  checks.push({
    id: "no_placeholders",
    label: "No placeholder tokens",
    passed: !placeholderHit,
    detail: placeholderHit ? `Contains "${placeholderHit[0]}"` : null,
  });

  // 4. Recipient email valid
  const email = (input.recipientEmail ?? "").trim();
  checks.push({
    id: "recipient_email",
    label: "Valid recipient email",
    passed: EMAIL_RE.test(email),
    detail: email ? (EMAIL_RE.test(email) ? email : `"${email}" is not a valid email`) : "Missing recipient email",
  });

  // 5. Company + role identified
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

  // 6. Subject present
  const subject = (input.emailSubject ?? "").trim();
  checks.push({
    id: "subject_present",
    label: "Email subject drafted",
    passed: subject.length > 0 && !PLACEHOLDER_RE.test(subject),
    detail: subject.length === 0 ? "Subject missing" : null,
  });

  // 7. Resume attached
  checks.push({
    id: "resume_attached",
    label: "Resume PDF attached",
    passed: input.hasResume,
    detail: input.hasResume ? null : "Upload a master resume in Settings",
  });

  // 8. Grammar / spelling via LLM (only if letter present)
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
        passed: true,
        detail: "Grammar check skipped (model unavailable)",
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
