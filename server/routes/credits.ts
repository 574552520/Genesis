import { Router } from "express";
import { rechargeCredits } from "../services/db";

const router = Router();

const tierCredits = {
  standard: 50,
  pro: 200,
  enterprise: 1000,
} as const;

type Tier = keyof typeof tierCredits;

router.post("/recharge", async (req, res) => {
  try {
    const tier = req.body?.tier as Tier | undefined;
    if (!tier || !(tier in tierCredits)) {
      res.status(400).json({ error: "Invalid tier. Use standard/pro/enterprise." });
      return;
    }

    const credits = await rechargeCredits({
      userId: req.user!.id,
      tier,
      amount: tierCredits[tier],
    });

    res.json({
      credits,
      added: tierCredits[tier],
      tier,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to recharge";
    res.status(500).json({ error: message });
  }
});

export default router;
