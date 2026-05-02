import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storiesRouter from "./stories";
import sitemapRouter from "./sitemap";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storiesRouter);
router.use(sitemapRouter);

export default router;
