import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import educationRouter from "./education";
import teamRouter from "./team";
import otpRouter from "./otp";
import inventoryRouter from "./inventory";
import procurementRouter from "./procurement";
import hrRouter from "./hr";
import fiscalRouter from "./fiscal";
import cardsRouter from "./cards";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(educationRouter);
router.use(teamRouter);
router.use(otpRouter);
router.use(inventoryRouter);
router.use(procurementRouter);
router.use(hrRouter);
router.use(fiscalRouter);
router.use(cardsRouter);

export default router;
