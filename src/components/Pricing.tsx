import React, { useState } from "react";
import { Check } from "lucide-react";
import { api } from "../lib/api";
import type { CreditTier } from "../types";

const TIERS: Array<{
  key: CreditTier;
  name: string;
  credits: number;
  price: string;
  features: string[];
  color: string;
  popular?: boolean;
}> = [
  {
    key: "standard",
    name: "Standard",
    credits: 50,
    price: "$29",
    features: ["1K resolution", "Standard queue", "1 reference image"],
    color: "border-white/20",
  },
  {
    key: "pro",
    name: "Pro",
    credits: 200,
    price: "$99",
    features: ["2K resolution", "Priority queue", "Up to 6 reference images", "Commercial usage"],
    color: "border-white/60 bg-white/5",
    popular: true,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    credits: 1000,
    price: "$399",
    features: ["4K resolution", "Fast generation", "Unlimited references", "API access"],
    color: "border-[#D1DCE5]",
  },
];

export default function Pricing({
  onRechargeDone,
}: {
  onRechargeDone: () => Promise<void>;
}) {
  const [loadingTier, setLoadingTier] = useState<CreditTier | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRecharge = async (tier: CreditTier) => {
    setLoadingTier(tier);
    setMessage(null);
    setError(null);
    try {
      const result = await api.recharge(tier);
      setMessage(`Recharge successful: +${result.added} credits`);
      await onRechargeDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recharge failed");
    } finally {
      setLoadingTier(null);
    }
  };

  return (
    <div className="p-6 md:p-10 w-full">
      <header className="mb-12 text-center">
        <h1 className="font-display text-4xl md:text-5xl uppercase mb-2">Get credits</h1>
        <p className="font-mono text-xs opacity-60 uppercase tracking-widest">
          [ SYSTEM RESOURCES ]
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
        {TIERS.map((tier) => (
          <div
            key={tier.key}
            className={`relative p-8 rounded-2xl border ${tier.color} flex flex-col backdrop-blur-sm`}
          >
            {tier.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white text-[#647B8C] font-mono text-[10px] uppercase px-3 py-1 rounded-full font-bold tracking-widest">
                Recommended
              </div>
            )}

            <h3 className="font-display text-2xl uppercase mb-2">{tier.name}</h3>
            <div className="flex items-baseline gap-2 mb-6">
              <span className="font-display text-5xl">{tier.price}</span>
              <span className="font-mono text-xs opacity-50 uppercase">/ {tier.credits} CRD</span>
            </div>

            <ul className="space-y-4 mb-8 flex-1">
              {tier.features.map((feat) => (
                <li key={feat} className="flex items-start gap-3 font-mono text-xs opacity-80">
                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={() => void handleRecharge(tier.key)}
              disabled={loadingTier === tier.key}
              className={`w-full py-4 rounded-xl font-mono text-sm uppercase transition-colors disabled:opacity-60 ${tier.popular ? "bg-white text-[#647B8C] hover:bg-opacity-90" : "border border-white/30 hover:bg-white/10"}`}
            >
              {loadingTier === tier.key ? "Processing..." : "Choose this tier"}
            </button>
          </div>
        ))}
      </div>

      {message && (
        <div className="max-w-xl mx-auto mt-8 p-3 border rounded-lg font-mono text-xs bg-emerald-500/20 border-emerald-300/40">
          {message}
        </div>
      )}
      {error && (
        <div className="max-w-xl mx-auto mt-8 p-3 border rounded-lg font-mono text-xs bg-red-500/20 border-red-300/40">
          {error}
        </div>
      )}
    </div>
  );
}
