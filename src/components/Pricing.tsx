import React, { useState } from "react";
import { Check } from "lucide-react";
import { api } from "../lib/api";
import type { CreditTier } from "../types";

const TIERS: Array<{
  key: CreditTier;
  name: string;
  credits: number;
  price: string;
  validity: string;
  features: string[];
  color: string;
  popular?: boolean;
}> = [
  {
    key: "standard",
    name: "天卡",
    credits: 2000,
    price: "¥19",
    validity: "1 天",
    features: ["2000 积分", "有效期 1 天", "适合轻量体验"],
    color: "border-white/20",
  },
  {
    key: "pro",
    name: "周卡",
    credits: 12000,
    price: "¥99",
    validity: "7 天",
    features: ["12000 积分", "有效期 7 天", "更高性价比"],
    color: "border-white/60 bg-white/5",
    popular: true,
  },
  {
    key: "enterprise",
    name: "月卡",
    credits: 40000,
    price: "¥299",
    validity: "30 天",
    features: ["40000 积分", "有效期 30 天", "高频创作推荐"],
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
      const expiryText = result.expiresAt ? new Date(result.expiresAt).toLocaleString() : "未设置";
      setMessage(`充值成功：+${result.added} 积分；到期时间：${expiryText}`);
      await onRechargeDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "充值失败");
    } finally {
      setLoadingTier(null);
    }
  };

  return (
    <div className="p-6 md:p-10 w-full">
      <header className="mb-12 text-center">
        <h1 className="font-display text-4xl md:text-5xl uppercase mb-2">积分充值</h1>
        <p className="font-mono text-xs opacity-60 uppercase tracking-widest">[ SYSTEM RESOURCES ]</p>
      </header>

      <div className="max-w-5xl mx-auto mb-6 p-3 border rounded-lg font-mono text-xs bg-amber-500/15 border-amber-300/40">
        积分按卡包有效期计算，到期后积分会自动清零。
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
        {TIERS.map((tier) => (
          <div
            key={tier.key}
            className={`relative p-8 rounded-2xl border ${tier.color} flex flex-col backdrop-blur-sm`}
          >
            {tier.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white text-[#647B8C] font-mono text-[10px] uppercase px-3 py-1 rounded-full font-bold tracking-widest">
                推荐
              </div>
            )}

            <h3 className="font-display text-2xl uppercase mb-2">{tier.name}</h3>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="font-display text-5xl">{tier.price}</span>
              <span className="font-mono text-xs opacity-60 uppercase">/ {tier.validity}</span>
            </div>
            <div className="font-mono text-xs opacity-50 mb-6">{tier.credits} 积分</div>

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
              {loadingTier === tier.key ? "处理中..." : "立即充值"}
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
