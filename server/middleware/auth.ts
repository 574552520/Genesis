import type { NextFunction, Request, Response } from "express";
import { authClient } from "../services/db.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string | null;
      };
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.replace("Bearer ", "")
    : null;

  if (!token) {
    res.status(401).json({ error: "Missing Bearer token" });
    return;
  }

  try {
    const { data, error } = await getUserWithRetry(token);
    if (error || !data.user) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    req.user = {
      id: data.user.id,
      email: data.user.email ?? null,
    };

    next();
  } catch (error) {
    if (isTransientAuthNetworkError(error)) {
      res.status(503).json({ error: "Auth service temporarily unavailable, please retry" });
      return;
    }

    next(error);
  }
}

async function getUserWithRetry(token: string) {
  try {
    return await authClient.auth.getUser(token);
  } catch (error) {
    if (!isTransientAuthNetworkError(error)) {
      throw error;
    }

    // Retry once to absorb transient socket resets from upstream.
    await sleep(120);
    return authClient.auth.getUser(token);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTransientAuthNetworkError(error: unknown): boolean {
  const stack = [error as any];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    const code = typeof cur.code === "string" ? cur.code : "";
    const message = typeof cur.message === "string" ? cur.message.toLowerCase() : "";
    const name = typeof cur.name === "string" ? cur.name.toLowerCase() : "";

    if (
      code === "UND_ERR_SOCKET" ||
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "EAI_AGAIN" ||
      message.includes("fetch failed") ||
      message.includes("other side closed") ||
      name.includes("socketerror")
    ) {
      return true;
    }

    if (typeof cur.cause === "object" && cur.cause) {
      stack.push(cur.cause);
    }
  }
  return false;
}
