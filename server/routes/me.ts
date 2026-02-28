import { Router } from "express";
import { getProfile } from "../services/db.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const profile = await getProfile(req.user!.id, req.user!.email);
    res.json({ profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load profile";
    res.status(500).json({ error: message });
  }
});

export default router;
