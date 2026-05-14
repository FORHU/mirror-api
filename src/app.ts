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

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) ?? [];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, mobile, curl) or whitelisted origins
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // preflight for all routes


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
