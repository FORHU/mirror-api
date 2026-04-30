import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import router from "./routes";
import { isDev } from "./config";
import setup from "./setup";
import cors from "cors";
import { errorHandler } from "./middleware/error.middleware";

const app = express();

app.set("trust proxy", 1);

app.use(
  cors({
    origin: "*",
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

if (!isDev) app.use(limiter);

// Set up security headers
app.use(helmet());
app.disable("x-powered-by");

// Use router for routing
app.use("/api", router);

// Error Handling
app.use(errorHandler);

// Run setup
setup().catch((err) => {
  console.log("Setup failed:", err);
});

export default app;
