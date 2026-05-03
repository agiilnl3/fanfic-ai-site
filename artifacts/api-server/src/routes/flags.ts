import { Router, type IRouter } from "express";
import { getActiveFlagsForUser } from "../lib/featureFlags";

const router: IRouter = Router();

router.get("/flags", async (req, res): Promise<void> => {
  const userId = req.user?.id ?? null;
  try {
    const flags = await getActiveFlagsForUser(userId);
    res.json({ flags });
  } catch {
    res.json({ flags: {} });
  }
});

export default router;
