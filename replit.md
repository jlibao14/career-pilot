# Career Pilot

Single-user job application automation. Paste a job URL or posting text;
Claude parses it, drafts an executive-tone cover letter (200–280 words,
3 paragraphs), runs a validation gate, and sends via AgentMail from
`jlibao@agentmail.to`. The master resume PDF lives in App Storage.

## Architecture

Monorepo (pnpm) with three artifacts:

- `artifacts/api-server` — Express 5 + Drizzle/Postgres. Routes:
  `/profile`, `/resume`, `/applications` (CRUD + `:id/draft`,
  `:id/letter`, `:id/recipient`, `:id/send`), `/dashboard/summary`,
  `/storage/uploads/request-url`. Libs: `jobParser` (URL fetch with
  SSRF guards + HTML stripping, LLM extraction), `letterWriter`
  (Anthropic prompt that uses profile tone + key achievements),
  `validator` (presence, length, paragraph structure, placeholders,
  recipient sanity, attachment, grammar/spelling), `agentMail`,
  `objectStorage` + `objectAcl`.
- `artifacts/career-pilot` — React + Vite UI. Pages: Dashboard,
  Settings (profile + resume upload + tone/achievements), New
  Application (URL/text intake, preview vs auto mode), Application
  Detail (editable letter + subject + job details + recipient,
  validation report, send/resend).
- `artifacts/mockup-sandbox` — design canvas only.

Shared libs:
- `lib/db` — Drizzle schema (`profile`, `applications`).
  `pnpm --filter @workspace/db run push` syncs schema to Postgres.
- `lib/api-spec` — OpenAPI source of truth.
  `pnpm --filter @workspace/api-spec run codegen` regenerates clients
  via Orval.
- `lib/api-zod` — generated Zod validators (server-side request
  validation). After codegen, ensure `src/index.ts` is the single line
  `export * from "./generated/api";` to avoid duplicate exports.
- `lib/api-client-react` — generated TanStack Query hooks.

## Required environment

- `DATABASE_URL` — Replit Postgres
- `AGENTMAIL_API_KEY` — AgentMail send API
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`,
  `PUBLIC_OBJECT_SEARCH_PATHS` — App Storage. `PRIVATE_OBJECT_DIR`
  must be a `/bucket/path` style absolute path; resumes are uploaded
  under `${PRIVATE_OBJECT_DIR}/uploads/<uuid>` and surfaced as
  `/objects/uploads/<uuid>`.
- Anthropic access is provided through Replit's AI proxy (no key
  needed in env).

## Runbook

- `pnpm -w run typecheck` — full workspace typecheck.
- `pnpm --filter @workspace/db run push` — push Drizzle schema.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate
  api-zod + api-client-react.
- Workflows auto-restart api-server and career-pilot on edit; run
  the api-server workflow restart after schema or env changes.

## User preferences

- Executive tone for cover letters (200–280 words, 3 paragraphs).
- Send-from address is fixed: `jlibao@agentmail.to`.
- Single master resume PDF; max 10 MB.
