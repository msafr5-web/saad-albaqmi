import { Router, type IRouter } from "express";
import healthRouter from "./health";
import educationRouter from "./education";

const router: IRouter = Router();

router.use(healthRouter);
router.use(educationRouter);

export default router;
