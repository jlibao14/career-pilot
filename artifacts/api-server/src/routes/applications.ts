import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, applicationsTable, profileTable } from "@workspace/db";
import {
  CreateApplicationBody,
  UpdateApplicationLetterBody,
  UpdateApplicationRecipientBody,
} from "@workspace/api-zod";
import { fetchJobFromUrl, parseJob } from "../lib/jobParser";
import { draftCoverLetter } from "../lib/letterWriter";
import { validateApplication } from "../lib/validator";
import { sendEmail } from "../lib/agentMail";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();

function parseId(raw: string | string[] | undefined): number | null {
  if (raw == null) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

router.get("/applications", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(applicationsTable)
    .orderBy(desc(applicationsTable.createdAt));
  res.json(rows);
});

router.post("/applications", async (req, res): Promise<void> => {
  const parsed = CreateApplicationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { sourceType, sourceUrl, sourceText } = parsed.data;
  if (sourceType === "url" && !sourceUrl) {
    res.status(400).json({ error: "sourceUrl is required when sourceType is 'url'" });
    return;
  }
  if (sourceType === "text" && !sourceText) {
    res.status(400).json({ error: "sourceText is required when sourceType is 'text'" });
    return;
  }

  const [created] = await db
    .insert(applicationsTable)
    .values({
      sourceType,
      sourceUrl: sourceUrl ?? null,
      sourceText: sourceText ?? null,
      status: "draft",
    })
    .returning();

  const mode = parsed.data.mode ?? "preview";

  // Always parse so the user has the extracted job details to review
  try {
    const parsedApp = await runParsePipeline(created!.id);

    if (mode !== "auto") {
      res.status(201).json(parsedApp);
      return;
    }

    const drafted = await runDraftPipeline(parsedApp.id);

    if (parsed.data.autoSend !== false && drafted.validation?.passed) {
      try {
        const sent = await runSendPipeline(drafted.id, { autoSent: true });
        res.status(201).json(sent);
        return;
      } catch (sendErr) {
        req.log.error({ err: sendErr }, "Auto-send failed; returning draft for review");
        const [reloaded] = await db
          .select()
          .from(applicationsTable)
          .where(eq(applicationsTable.id, created!.id));
        res.status(201).json(reloaded);
        return;
      }
    }

    res.status(201).json(drafted);
  } catch (err) {
    req.log.error({ err }, "Auto-processing failed");
    const message = err instanceof Error ? err.message : "Processing failed";
    await db
      .update(applicationsTable)
      .set({ status: "failed", errorMessage: message })
      .where(eq(applicationsTable.id, created!.id));
    const [reloaded] = await db
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.id, created!.id));
    res.status(201).json(reloaded);
  }
});

router.get("/applications/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.delete("/applications/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(applicationsTable).where(eq(applicationsTable.id, id));
  res.sendStatus(204);
});

// Parse + draft + validate (used by the "process again" button)
router.post("/applications/:id/process", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    await runParsePipeline(id);
    const drafted = await runDraftPipeline(id);
    res.json(drafted);
  } catch (err) {
    req.log.error({ err }, "Process failed");
    const message = err instanceof Error ? err.message : "Processing failed";
    if (message === "Application not found") {
      res.status(404).json({ error: message });
      return;
    }
    await db
      .update(applicationsTable)
      .set({ status: "failed", errorMessage: message })
      .where(eq(applicationsTable.id, id));
    res.status(500).json({ error: message });
  }
});

// Draft (assumes parse already ran). Used by the "Generate cover letter" button.
router.post("/applications/:id/draft", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const drafted = await runDraftPipeline(id);
    res.json(drafted);
  } catch (err) {
    req.log.error({ err }, "Draft failed");
    const message = err instanceof Error ? err.message : "Draft failed";
    if (message === "Application not found") {
      res.status(404).json({ error: message });
      return;
    }
    await db
      .update(applicationsTable)
      .set({ status: "failed", errorMessage: message })
      .where(eq(applicationsTable.id, id));
    res.status(500).json({ error: message });
  }
});

router.patch("/applications/:id/letter", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateApplicationLetterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updates: Record<string, unknown> = { coverLetter: parsed.data.coverLetter };
  if (parsed.data.emailSubject !== undefined) updates.emailSubject = parsed.data.emailSubject;

  const [row] = await db
    .update(applicationsTable)
    .set(updates)
    .where(eq(applicationsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const profile = (await db.select().from(profileTable).limit(1))[0];
  const validation = await validateApplication({
    coverLetter: row.coverLetter,
    emailSubject: row.emailSubject,
    recipientEmail: row.recipientEmail,
    company: row.company,
    roleTitle: row.roleTitle,
    hasResume: !!profile?.resumeObjectPath,
  });
  const [revalidated] = await db
    .update(applicationsTable)
    .set({
      validation,
      status: validation.passed ? "ready" : "needs_review",
    })
    .where(eq(applicationsTable.id, id))
    .returning();
  res.json(revalidated);
});

router.patch("/applications/:id/recipient", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateApplicationRecipientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(applicationsTable)
    .set({
      recipientEmail: parsed.data.recipientEmail,
      recipientName: parsed.data.recipientName ?? null,
    })
    .where(eq(applicationsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const profile = (await db.select().from(profileTable).limit(1))[0];
  const validation = await validateApplication({
    coverLetter: row.coverLetter,
    emailSubject: row.emailSubject,
    recipientEmail: row.recipientEmail,
    company: row.company,
    roleTitle: row.roleTitle,
    hasResume: !!profile?.resumeObjectPath,
  });
  const [revalidated] = await db
    .update(applicationsTable)
    .set({
      validation,
      status: validation.passed ? "ready" : "needs_review",
    })
    .where(eq(applicationsTable.id, id))
    .returning();
  res.json(revalidated);
});

router.post("/applications/:id/send", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const sent = await runSendPipeline(id, { autoSent: false });
    res.json(sent);
  } catch (err) {
    req.log.error({ err }, "Send failed");
    const message = err instanceof Error ? err.message : "Send failed";
    res.status(400).json({ error: message });
  }
});

// ---------- pipeline helpers ----------

async function runParsePipeline(id: number) {
  const [app] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, id));
  if (!app) throw new Error("Application not found");

  await db
    .update(applicationsTable)
    .set({ status: "parsing", errorMessage: null })
    .where(eq(applicationsTable.id, id));

  let jobText = app.sourceText ?? "";
  if (app.sourceType === "url" && app.sourceUrl) {
    try {
      jobText = await fetchJobFromUrl(app.sourceUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch URL";
      await db
        .update(applicationsTable)
        .set({ status: "failed", errorMessage: message })
        .where(eq(applicationsTable.id, id));
      throw err;
    }
  }

  if (!jobText.trim()) {
    await db
      .update(applicationsTable)
      .set({ status: "failed", errorMessage: "No job content to parse" })
      .where(eq(applicationsTable.id, id));
    throw new Error("No job content to parse");
  }

  const parsed = await parseJob(jobText, app.sourceUrl);

  const [updated] = await db
    .update(applicationsTable)
    .set({
      status: "needs_review",
      company: parsed.company,
      roleTitle: parsed.roleTitle,
      location: parsed.location,
      recipientEmail: parsed.recipientEmail,
      recipientName: parsed.recipientName,
      jobSummary: parsed.jobSummary,
      keyRequirements: parsed.keyRequirements,
    })
    .where(eq(applicationsTable.id, id))
    .returning();

  return updated!;
}

async function runDraftPipeline(id: number) {
  const [app] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, id));
  if (!app) throw new Error("Application not found");

  if (!app.company || !app.roleTitle) {
    throw new Error("Job has not been parsed yet — run parse first");
  }

  await db
    .update(applicationsTable)
    .set({ status: "drafting", errorMessage: null })
    .where(eq(applicationsTable.id, id));

  const [profile] = await db.select().from(profileTable).limit(1);
  if (!profile) throw new Error("Profile not configured");

  const drafted = await draftCoverLetter(profile, {
    company: app.company,
    roleTitle: app.roleTitle,
    location: app.location,
    recipientEmail: app.recipientEmail,
    recipientName: app.recipientName,
    jobSummary:
      app.jobSummary ??
      (app.sourceText
        ? app.sourceText.slice(0, 1500)
        : `${app.roleTitle} role at ${app.company}.`),
    keyRequirements: app.keyRequirements ?? [],
  });

  await db
    .update(applicationsTable)
    .set({
      status: "validating",
      coverLetter: drafted.coverLetter,
      emailSubject: drafted.emailSubject,
    })
    .where(eq(applicationsTable.id, id));

  const validation = await validateApplication({
    coverLetter: drafted.coverLetter,
    emailSubject: drafted.emailSubject,
    recipientEmail: app.recipientEmail,
    company: app.company,
    roleTitle: app.roleTitle,
    hasResume: !!profile.resumeObjectPath,
  });

  const [final] = await db
    .update(applicationsTable)
    .set({
      validation,
      status: validation.passed ? "ready" : "needs_review",
    })
    .where(eq(applicationsTable.id, id))
    .returning();

  return final!;
}

async function runSendPipeline(id: number, opts: { autoSent: boolean }) {
  const [app] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, id));
  if (!app) throw new Error("Application not found");

  const [profile] = await db.select().from(profileTable).limit(1);
  if (!profile) throw new Error("Profile not configured");

  const validation = await validateApplication({
    coverLetter: app.coverLetter,
    emailSubject: app.emailSubject,
    recipientEmail: app.recipientEmail,
    company: app.company,
    roleTitle: app.roleTitle,
    hasResume: !!profile.resumeObjectPath,
  });

  if (!validation.passed) {
    const failedLabels = validation.checks.filter((c) => !c.passed).map((c) => c.label);
    await db
      .update(applicationsTable)
      .set({ validation, status: "needs_review" })
      .where(eq(applicationsTable.id, id));
    throw new Error(`Validation failed: ${failedLabels.join("; ")}`);
  }

  await db
    .update(applicationsTable)
    .set({ status: "sending", errorMessage: null })
    .where(eq(applicationsTable.id, id));

  let attachment: { filename: string; content: string; contentType: string };
  try {
    attachment = await loadResumeAttachment(profile.resumeObjectPath, profile.resumeFileName);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load resume attachment";
    await db
      .update(applicationsTable)
      .set({ status: "needs_review", errorMessage: message })
      .where(eq(applicationsTable.id, id));
    throw new Error(`Cannot send: ${message}`);
  }

  try {
    const result = await sendEmail({
      to: app.recipientEmail!,
      subject: app.emailSubject!,
      text: app.coverLetter!,
      attachments: [attachment],
    });

    const [sent] = await db
      .update(applicationsTable)
      .set({
        status: "sent",
        sentAt: new Date(),
        autoSent: opts.autoSent,
        agentmailMessageId: result.messageId,
        validation,
      })
      .where(eq(applicationsTable.id, id))
      .returning();
    return sent!;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    await db
      .update(applicationsTable)
      .set({ status: "failed", errorMessage: message })
      .where(eq(applicationsTable.id, id));
    throw err;
  }
}

async function loadResumeAttachment(
  objectPath: string | null,
  fileName: string | null,
): Promise<{ filename: string; content: string; contentType: string }> {
  if (!objectPath) throw new Error("No resume on file");
  const file = await storage.getObjectEntityFile(objectPath);
  const [buffer] = await file.download();
  const [metadata] = await file.getMetadata();
  const contentType =
    typeof metadata.contentType === "string" ? metadata.contentType : "application/pdf";
  return {
    filename: fileName || "resume.pdf",
    content: buffer.toString("base64"),
    contentType,
  };
}

export default router;
