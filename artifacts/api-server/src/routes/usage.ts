import { Router, type IRouter } from "express";
import { GetMyUsageQueryParams } from "@workspace/api-zod";
import { getUsage } from "../lib/usage";

const router: IRouter = Router();

router.get("/usage/me", async (req, res): Promise<void> => {
  const parsed = GetMyUsageQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "authorName required" });
    return;
  }
  const author = parsed.data.authorName.trim();
  if (!author) {
    res.status(400).json({ error: "authorName required" });
    return;
  }
  // Pass the authenticated user id so Conjurer subscribers see their
  // higher limits in the meter immediately after checkout. Anonymous
  // callers always resolve to free.
  res.json(await getUsage(author, req.user?.id ?? null));
});

export default router;
