# Career Pilot

> Paste a job posting. Get a vetted, executive-tone cover letter sent with your resume — without leaving the app.

Career Pilot is a single-user job application automation tool. Drop in a job URL or pasted posting, and it parses the role, drafts a tailored cover letter with Claude, runs it through a validation gate, and sends it via AgentMail with your master resume attached. A full-auto mode chains all of that into one click.

## Features

- **Job intake** — accept either a job URL (server-side fetch with SSRF guards and HTML stripping) or pasted posting text.
- **AI parsing** — Claude extracts company, role, location, recipient, summary, and key requirements from raw postings.
- **Executive cover-letter drafting** — 200–280 words, three paragraphs, grounded in your profile tone and key achievements.
- **Validation gate** — checks for length, paragraph structure, placeholders, recipient sanity, attached resume, and grammar/spelling before anything is sent.
- **Auto-fix** — one-click LLM correction targeting only the failing checks, then re-validated before commit.
- **Integrated sending** — AgentMail delivery from a fixed sender address, with the master resume attached automatically.
- **Full-auto mode** — intake → parse → draft → validate → send in a single submission, with safe fallback to manual review when validation fails.

## How it works

```
Intake  ─►  Parse  ─►  Draft  ─►  Validate  ─►  Send
 URL or      Claude     Claude     Rules +       AgentMail
 pasted      extracts   writes     grammar       w/ resume
 text        fields     letter     checks        attached
```

Each application moves through statuses (`draft → parsing → needs_review → drafting → validating → ready → sent`) and is editable at any step. Validation failures route the application to manual review instead of sending.

## Tech stack

- **Frontend:** React 19, Vite, Tailwind CSS v4, Radix UI, TanStack Query, wouter
- **Backend:** Express 5, Drizzle ORM on Postgres, pino logging
- **AI:** Anthropic Claude via Replit's AI proxy (no API key required in env)
- **Email:** AgentMail
- **Storage:** Google Cloud Storage (Replit App Storage) for the master resume PDF
- **Tooling:** pnpm monorepo, OpenAPI + Orval codegen for typed clients/validators

## Project structure

```
artifacts/
  career-pilot/      React + Vite web UI
  api-server/        Express API (parse, draft, validate, send)
  mockup-sandbox/    Design canvas (not part of the app runtime)
lib/
  db/                Drizzle schema (profile, applications)
  api-spec/          OpenAPI spec — source of truth
  api-zod/           Generated Zod request validators
  api-client-react/  Generated TanStack Query hooks
  object-storage-*/  GCS helpers
```

## Prerequisites

- Node.js 20+
- pnpm 9+
- A Postgres database (Replit Postgres works out of the box)
- An AgentMail account and API key
- A Google Cloud Storage bucket (or Replit App Storage)
- Run on Replit to get Anthropic access via the built-in AI proxy

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `AGENTMAIL_API_KEY` | AgentMail send API key |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | GCS bucket for resume storage |
| `PRIVATE_OBJECT_DIR` | Absolute `/bucket/path` prefix for private uploads (resumes land at `${PRIVATE_OBJECT_DIR}/uploads/<uuid>`) |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Comma-separated public search paths |
| `PORT` | Port each artifact's dev server binds to (assigned by Replit) |

Anthropic access goes through Replit's AI integration proxy. On Replit, the proxy provisions `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` and `AI_INTEGRATIONS_ANTHROPIC_API_KEY` for you — you don't set them by hand. For non-Replit runs, you'll need to provide equivalent values yourself.

## Setup

```bash
pnpm install
pnpm --filter @workspace/db run push          # sync Drizzle schema to Postgres
pnpm --filter @workspace/api-spec run codegen # regenerate api-zod + api-client-react
pnpm -w run typecheck                         # full workspace typecheck
```

## Running locally

Run the API server and the web app in separate terminals:

```bash
# API
pnpm --filter @workspace/api-server run dev

# Web UI
pnpm --filter @workspace/career-pilot run dev
```

On Replit, the configured workflows start both automatically and restart on edit. Restart the api-server workflow after schema or env changes.

## Notes & caveats

- **Single-user tool.** There is no auth, no multi-tenancy, and the sender address is hardcoded to `jlibao@agentmail.to`. Don't expose this publicly as-is.
- **One master resume.** A single PDF (max 10 MB) is uploaded once in Settings and attached to every send.
- **URL fetcher is guarded** against SSRF, but the LLM-extracted recipient should still be reviewed before sending in non-auto mode.
- **Auto mode falls back to review** when the validation gate fails — nothing is sent unless every check passes.

## Roadmap

- Background sending so the UI never blocks on the send pipeline
- Auth so the app can be safely exposed
- Reply and follow-up tracking per application
- One-click undo for cover-letter edits
