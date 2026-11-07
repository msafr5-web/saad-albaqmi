import { Router, type IRouter } from "express";
import healthRouter from "./health";
import educationRouter from "./education";
import teamRouter from "./team";
import otpRouter from "./otp";
import inventoryRouter from "./inventory";
import procurementRouter from "./procurement";
import hrRouter from "./hr";
import fiscalRouter from "./fiscal";

const router: IRouter = Router();

router.use(healthRouter);
router.use(educationRouter);
router.use(teamRouter);
router.use(otpRouter);
router.use(inventoryRouter);
router.use(procurementRouter);
router.use(hrRouter);
router.use(fiscalRouter);

export default router;
