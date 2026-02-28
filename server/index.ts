import "dotenv/config";
import cors from "cors";
import express from "express";
import { requireAuth } from "./middleware/auth.js";
import creditsRouter from "./routes/credits.js";
import generationsRouter from "./routes/generations.js";
import meRouter from "./routes/me.js";
import { queueSnapshot } from "./services/queue.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const corsOrigin = process.env.APP_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean);

app.use(
  cors({
    origin: corsOrigin && corsOrigin.length > 0 ? corsOrigin : true,
  }),
);
app.use(express.json({ limit: "25mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    queue: queueSnapshot(),
    at: new Date().toISOString(),
  });
});

app.use("/api/me", requireAuth, meRouter);
app.use("/api/credits", requireAuth, creditsRouter);
app.use("/api/generations", requireAuth, generationsRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Internal server error";
  res.status(500).json({ error: message });
});

app.listen(port, () => {
  console.log(`Genesis API listening on http://localhost:${port}`);
});
