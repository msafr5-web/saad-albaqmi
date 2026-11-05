import { Router, type IRouter } from "express";
import healthRouter from "./health";
import educationRouter from "./education";
import teamRouter from "./team";

const router: IRouter = Router();

router.use(healthRouter);
router.use(educationRouter);
router.use(teamRouter);

export default router;
