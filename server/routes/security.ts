import { Router } from "express";

const router = Router();

router.post("/turnstile/verify", async (req, res) => {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) {
      res.status(400).json({ error: "Missing captcha token" });
      return;
    }

    const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
    if (!secret) {
      res.status(500).json({ error: "Server captcha is not configured" });
      return;
    }

    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      "error-codes"?: string[];
    };

    if (!response.ok) {
      res.status(502).json({
        error: "Captcha provider request failed",
        success: false,
      });
      return;
    }

    if (!payload.success) {
      res.status(400).json({
        success: false,
        errorCodes: payload["error-codes"] ?? [],
      });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Captcha verification failed";
    res.status(500).json({ error: message, success: false });
  }
});

export default router;
