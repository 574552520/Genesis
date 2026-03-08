import "dotenv/config";
import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "./middleware/auth.js";
import commerceRouter from "./routes/commerce.js";
import creditsRouter from "./routes/credits.js";
import generationsRouter from "./routes/generations.js";
import meRouter from "./routes/me.js";
import securityRouter from "./routes/security.js";
import { queueSnapshot } from "./services/queue.js";

const app = express();
const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number(process.env.PORT ?? 8877);
const corsOrigin = process.env.APP_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean);
const bodyLimit = process.env.API_BODY_LIMIT?.trim() || "80mb";
const apiDebugLog = process.env.API_DEBUG_LOG !== "0";

function summarizeRequestBody(body: unknown): string {
  if (!body || typeof body !== "object") return "no-body";
  const b = body as Record<string, unknown>;
  const keys = Object.keys(b);
  const parts: string[] = [`keys=${keys.slice(0, 8).join(",") || "none"}`];
  if (typeof b.prompt === "string") parts.push(`promptLen=${(b.prompt as string).length}`);
  if (Array.isArray(b.referenceImages)) parts.push(`referenceImages=${b.referenceImages.length}`);
  if (typeof b.model === "string") parts.push(`model=${b.model}`);
  if (typeof b.imageSize === "string") parts.push(`imageSize=${b.imageSize}`);
  if (typeof b.aspectRatio === "string") parts.push(`aspectRatio=${b.aspectRatio}`);
  return parts.join(" ");
}

app.use(
  cors({
    origin: corsOrigin && corsOrigin.length > 0 ? corsOrigin : true,
  }),
);
app.use(express.json({ limit: bodyLimit }));

app.use((req, res, next) => {
  if (!apiDebugLog) {
    next();
    return;
  }

  const requestId = randomUUID().slice(0, 8);
  const startedAt = process.hrtime.bigint();
  const bodySummary = summarizeRequestBody(req.body);
  const packIdHint =
    req.method === "GET" && req.originalUrl.startsWith("/api/commerce/pack/")
      ? req.originalUrl.split("?")[0].split("/").pop()
      : undefined;
  const routeHint = packIdHint ? `packId=${packIdHint}` : "";
  console.log(
    `[API][${requestId}] -> ${req.method} ${req.originalUrl} ${routeHint} ip=${req.ip ?? "-"} ${bodySummary}`,
  );

  res.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.log(
      `[API][${requestId}] <- ${req.method} ${req.originalUrl} status=${res.statusCode} time=${elapsedMs.toFixed(1)}ms`,
    );
  });

  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    queue: queueSnapshot(),
    at: new Date().toISOString(),
  });
});

app.use("/api/security", securityRouter);
app.use("/api/me", requireAuth, meRouter);
app.use("/api/credits", requireAuth, creditsRouter);
app.use("/api/generations", requireAuth, generationsRouter);
app.use("/api/commerce", requireAuth, commerceRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error as { type?: string }).type === "entity.too.large"
  ) {
    res.status(413).json({
      error: `Request payload too large. Reduce image size/count or increase API_BODY_LIMIT (current: ${bodyLimit}).`,
    });
    return;
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  res.status(500).json({ error: message });
});

const server = app.listen(port, host, () => {
  console.log(`Genesis API listening on http://${host}:${port}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EACCES") {
    console.error(
      `Failed to bind Genesis API on ${host}:${port}. On Windows this often means the port is reserved by the system. Update HOST/PORT in .env and restart.`,
    );
    process.exit(1);
  }

  if (error.code === "EADDRINUSE") {
    console.error(`Genesis API port ${port} is already in use on ${host}. Update PORT in .env and restart.`);
    process.exit(1);
  }

  throw error;
});
