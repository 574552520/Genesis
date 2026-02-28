import type { NextFunction, Request, Response } from "express";
import { authClient } from "../services/db";

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

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  req.user = {
    id: data.user.id,
    email: data.user.email ?? null,
  };

  next();
}
