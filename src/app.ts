import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import cors from "cors";
import router from "./routes";
import { isDev } from "./config";
import { errorHandler } from "./middleware/error.middleware";

const app = express();

app.set("trust proxy", 1);

app.use(helmet());
app.disable("x-powered-by");

app.use(
  cors({
    origin: "*",
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

if (!isDev) app.use(limiter);

app.use("/api", router);

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    status: "error",
    statusCode: 404,
    message: "Not found",
  });
});

app.use(errorHandler);

export default app;
