import { Router, type IRouter } from "express";
import healthRouter from "./health";
import educationRouter from "./education";
import teamRouter from "./team";
import otpRouter from "./otp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(educationRouter);
router.use(teamRouter);
router.use(otpRouter);

export default router;
