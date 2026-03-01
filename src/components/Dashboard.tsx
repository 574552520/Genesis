import React, { useState } from "react";
import {
  Hexagon,
  LogOut,
  Image as ImageIcon,
  History as HistoryIcon,
  CreditCard,
} from "lucide-react";
import Generator from "./Generator";
import History from "./History";
import Pricing from "./Pricing";
import type { UserProfile } from "../types";

type Tab = "generate" | "history" | "pricing";

export default function Dashboard({
  profile,
  userEmail,
  onRefreshProfile,
  onLogout,
}: {
  profile: UserProfile | null;
  userEmail: string;
  onRefreshProfile: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("generate");

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-white/10 flex flex-col bg-[#3A4A54]/20 backdrop-blur-sm">
        <div className="p-6 border-b border-white/10 flex items-center gap-3">
          <Hexagon className="w-6 h-6" />
          <span className="font-display text-xl tracking-wider">GNSIS</span>
        </div>

        <div className="p-6 border-b border-white/10">
          <div className="font-mono text-[10px] uppercase opacity-50 mb-1">Current user</div>
          <div className="font-mono text-sm truncate">{userEmail}</div>
          <div className="mt-4 flex items-center justify-between font-mono text-xs">
            <span className="opacity-70">Credits</span>
            <span className="text-[#D1DCE5]">{profile?.credits ?? "..."} CRD</span>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setActiveTab("generate")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-mono text-xs uppercase transition-colors ${activeTab === "generate" ? "bg-white/10 text-white" : "opacity-60 hover:opacity-100 hover:bg-white/5"}`}
          >
            <ImageIcon className="w-4 h-4" /> Generate
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-mono text-xs uppercase transition-colors ${activeTab === "history" ? "bg-white/10 text-white" : "opacity-60 hover:opacity-100 hover:bg-white/5"}`}
          >
            <HistoryIcon className="w-4 h-4" /> History
          </button>
          <button
            onClick={() => setActiveTab("pricing")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-mono text-xs uppercase transition-colors ${activeTab === "pricing" ? "bg-white/10 text-white" : "opacity-60 hover:opacity-100 hover:bg-white/5"}`}
          >
            <CreditCard className="w-4 h-4" /> Recharge
          </button>
        </nav>

        <div className="p-4 border-t border-white/10">
          <button
            onClick={() => void onLogout()}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg font-mono text-xs uppercase opacity-60 hover:opacity-100 hover:bg-white/5 transition-colors text-red-300"
          >
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto relative">
        <div className={activeTab === "generate" ? "block" : "hidden"}>
          <Generator
            isVisible={activeTab === "generate"}
            credits={profile?.credits ?? null}
            onGenerationDone={onRefreshProfile}
          />
        </div>
        {activeTab === "history" && <History />}
        {activeTab === "pricing" && <Pricing onRechargeDone={onRefreshProfile} />}
      </main>
    </div>
  );
}
