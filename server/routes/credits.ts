import { Router } from "express";
import { rechargeCredits } from "../services/db.js";

const router = Router();

const tierPlans = {
  standard: {
    credits: 2000,
    priceCny: 19,
    validityDays: 1,
    name: "day",
  },
  pro: {
    credits: 12000,
    priceCny: 99,
    validityDays: 7,
    name: "week",
  },
  enterprise: {
    credits: 40000,
    priceCny: 299,
    validityDays: 30,
    name: "month",
  },
} as const;

type Tier = keyof typeof tierPlans;

router.post("/recharge", async (req, res) => {
  try {
    const tier = req.body?.tier as Tier | undefined;
    if (!tier || !(tier in tierPlans)) {
      res.status(400).json({ error: "Invalid tier. Use standard/pro/enterprise." });
      return;
    }

    const plan = tierPlans[tier];
    const expiresAt = new Date(Date.now() + plan.validityDays * 24 * 60 * 60 * 1000).toISOString();

    const result = await rechargeCredits({
      userId: req.user!.id,
      tier,
      amount: plan.credits,
      expiresAt,
    });

    res.json({
      credits: result.credits,
      added: plan.credits,
      tier,
      expiresAt: result.creditsExpiresAt,
      validityDays: plan.validityDays,
      priceCny: plan.priceCny,
      plan: plan.name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to recharge";
    res.status(500).json({ error: message });
  }
});

export default router;
