import { Router, type IRouter } from "express";
import healthRouter from "./health";
import profileRouter from "./profile";
import applicationsRouter from "./applications";
import dashboardRouter from "./dashboard";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(profileRouter);
router.use(applicationsRouter);
router.use(dashboardRouter);
router.use(storageRouter);

export default router;
