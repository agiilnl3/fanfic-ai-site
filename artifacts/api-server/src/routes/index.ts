import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storiesRouter from "./stories";
import sitemapRouter from "./sitemap";
import storageRouter from "./storage";
import adminRouter from "./admin";
import authorsRouter from "./authors";
import notificationsRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storiesRouter);
router.use(sitemapRouter);
router.use(storageRouter);
router.use(adminRouter);
router.use(authorsRouter);
router.use(notificationsRouter);

export default router;
