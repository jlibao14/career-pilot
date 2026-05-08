import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, profileTable } from "@workspace/db";
import { UpdateProfileBody, SetResumeBody } from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();

async function ensureProfile() {
  const rows = await db.select().from(profileTable).limit(1);
  if (rows.length > 0) return rows[0]!;
  const [created] = await db
    .insert(profileTable)
    .values({ fullName: "", email: "" })
    .returning();
  return created!;
}

function publicProfile(p: Awaited<ReturnType<typeof ensureProfile>>) {
  const { resumeObjectPath: _path, ...rest } = p;
  return { ...rest, hasResume: !!p.resumeObjectPath };
}

router.get("/profile", async (_req, res): Promise<void> => {
  const profile = await ensureProfile();
  res.json(publicProfile(profile));
});

router.put("/profile", async (req, res): Promise<void> => {
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await ensureProfile();
  const [updated] = await db
    .update(profileTable)
    .set({ ...parsed.data })
    .where(eq(profileTable.id, existing.id))
    .returning();

  res.json(publicProfile(updated!));
});

router.post("/resume", async (req, res): Promise<void> => {
  const parsed = SetResumeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { objectPath, fileName } = parsed.data;

  if (!objectPath.startsWith("/objects/")) {
    res.status(400).json({ error: "objectPath must be a private /objects/... path" });
    return;
  }
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    res.status(400).json({ error: "Resume must be a .pdf file" });
    return;
  }

  // Verify the object exists and looks like a PDF before persisting
  try {
    const file = await storage.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    const ct = typeof metadata.contentType === "string" ? metadata.contentType : "";
    if (ct && ct !== "application/pdf") {
      res.status(400).json({ error: `Uploaded object is not a PDF (got ${ct})` });
      return;
    }
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(400).json({ error: "Uploaded object not found — finish the upload first" });
      return;
    }
    throw err;
  }

  const existing = await ensureProfile();
  const [updated] = await db
    .update(profileTable)
    .set({ resumeObjectPath: objectPath, resumeFileName: fileName })
    .where(eq(profileTable.id, existing.id))
    .returning();

  res.json(publicProfile(updated!));
});

export default router;
