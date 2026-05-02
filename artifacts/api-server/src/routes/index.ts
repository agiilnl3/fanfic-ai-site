import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storiesRouter from "./stories";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storiesRouter);

export default router;
