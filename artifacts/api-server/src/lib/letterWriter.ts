import { generateText } from "./anthropic";
import type { Profile } from "@workspace/db";
import type { ParsedJob } from "./jobParser";

export interface DraftedLetter {
  emailSubject: string;
  coverLetter: string;
}

export async function draftCoverLetter(
  profile: Profile,
  job: ParsedJob,
): Promise<DraftedLetter> {
  const system = `You are a senior career strategist drafting executive-tone cover letters.

Voice & rules:
- Tone: confident, calm, professional, with quiet personality. Never sycophantic, never breathless.
- Length: 200-280 words, exactly 3 paragraphs.
- Paragraph 1: hook tying the candidate's strongest credential to the role.
- Paragraph 2: 2-3 concrete, quantified proof points relevant to the posting.
- Paragraph 3: forward-looking close + clear next step.
- No buzzwords ("synergy", "rockstar", "ninja", "passionate"), no clichés ("I am writing to apply"), no exclamation marks.
- Address the recipient by name when one is provided; otherwise open with "Dear Hiring Team,".
- Sign off with "Best regards," followed by the candidate's full name on a new line.
- Use only information from the candidate profile and job posting. Do NOT fabricate companies, dates, metrics, or names.
- Never use placeholder tokens like [Company], [Role], TBD, or "INSERT_X". Every value must be a real string.
- Plain prose only. No markdown, no bullet points, no headings.`;

  const user = `Candidate profile:
- Name: ${profile.fullName || "(unknown)"}
- Email: ${profile.email || "(unknown)"}
- Headline: ${profile.headline ?? "(none)"}
- Location: ${profile.location ?? "(none)"}
- Summary: ${profile.summary ?? "(none)"}
- LinkedIn: ${profile.linkedin ?? "(none)"}
- Website: ${profile.website ?? "(none)"}

Job posting:
- Company: ${job.company ?? "(unknown)"}
- Role: ${job.roleTitle ?? "(unknown)"}
- Location: ${job.location ?? "(unknown)"}
- Recipient: ${job.recipientName ?? "(unknown)"}
- Summary: ${job.jobSummary ?? "(none)"}
- Key requirements:
${job.keyRequirements.map((r) => `  - ${r}`).join("\n") || "  - (none provided)"}

Output format — return ONLY this, no commentary:

SUBJECT: <one-line email subject; format "Application: <Role> — <Candidate Name>">

LETTER:
<the full cover letter as plain prose>`;

  const raw = await generateText({ system, user, maxTokens: 1500 });

  const subjectMatch = raw.match(/SUBJECT:\s*(.+)/i);
  const letterMatch = raw.match(/LETTER:\s*([\s\S]+)$/i);

  const emailSubject = (subjectMatch?.[1] ?? "").trim();
  const coverLetter = (letterMatch?.[1] ?? raw).trim();

  return {
    emailSubject:
      emailSubject ||
      `Application: ${job.roleTitle ?? "Role"} — ${profile.fullName || "Candidate"}`,
    coverLetter,
  };
}
