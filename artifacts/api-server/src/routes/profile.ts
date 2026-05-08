import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, profileTable } from "@workspace/db";
import { UpdateProfileBody, SetResumeBody } from "@workspace/api-zod";

const router: IRouter = Router();

async function ensureProfile() {
  const rows = await db.select().from(profileTable).limit(1);
  if (rows.length > 0) return rows[0]!;
  const [created] = await db
    .insert(profileTable)
    .values({ fullName: "", email: "" })
    .returning();
  return created!;
}

router.get("/profile", async (_req, res): Promise<void> => {
  const profile = await ensureProfile();
  res.json(profile);
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

  res.json(updated);
});

router.post("/resume", async (req, res): Promise<void> => {
  const parsed = SetResumeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await ensureProfile();
  const [updated] = await db
    .update(profileTable)
    .set({
      resumeObjectPath: parsed.data.objectPath,
      resumeFileName: parsed.data.fileName,
    })
    .where(eq(profileTable.id, existing.id))
    .returning();

  res.json(updated);
});

export default router;
