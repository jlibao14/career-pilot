import { Router, type IRouter } from "express";
import { db, applicationsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const rows = await db.select().from(applicationsTable);
  const summary = {
    total: rows.length,
    sent: rows.filter((r) => r.status === "sent").length,
    needsReview: rows.filter((r) => r.status === "needs_review").length,
    drafting: rows.filter((r) => ["draft", "parsing", "drafting", "validating", "sending"].includes(r.status)).length,
    failed: rows.filter((r) => r.status === "failed").length,
  };
  res.json(summary);
});

export default router;
