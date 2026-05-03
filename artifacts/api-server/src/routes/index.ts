import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storiesRouter from "./stories";
import sitemapRouter from "./sitemap";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storiesRouter);
router.use(sitemapRouter);
router.use(storageRouter);

export default router;
