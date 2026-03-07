import React, { useState } from "react";
import {
  BriefcaseBusiness,
  Hexagon,
  History as HistoryIcon,
  Image as ImageIcon,
  LogOut,
} from "lucide-react";
import Generator from "./Generator";
import History from "./History";
import CommerceWorkspace from "./CommerceWorkspace";
import type { UserProfile } from "../types";
import { usePreviewSizePreference } from "../hooks/usePreviewSizePreference";

type Tab = "generate" | "history" | "commerce";

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
  const { previewSize, setPreviewSize } = usePreviewSizePreference();

  return (
    <div className="h-[100dvh] min-h-0 flex flex-col md:flex-row overflow-hidden workspace-scroll-lock">
      <aside className="w-full md:w-64 min-h-0 border-b md:border-b-0 md:border-r border-white/10 flex flex-col overflow-hidden bg-[#3A4A54]/20 backdrop-blur-sm">
        <div className="p-6 border-b border-white/10 flex items-center gap-3">
          <Hexagon className="w-6 h-6" />
          <span className="font-display text-xl tracking-wider">GNSIS</span>
        </div>

        <div className="p-6 border-b border-white/10">
          <div className="font-mono text-[10px] uppercase opacity-50 mb-1">当前用户</div>
          <div className="font-mono text-sm truncate">{userEmail}</div>
          <div className="mt-4 flex items-center justify-between font-mono text-xs">
            <span className="opacity-70">积分</span>
            <span className="text-[#D1DCE5]">{profile?.credits ?? "..."} 积分</span>
          </div>
          <div className="mt-2 font-mono text-[10px] opacity-60">
            到期时间：{" "}
            {profile?.creditsExpiresAt
              ? new Date(profile.creditsExpiresAt).toLocaleString()
              : "未设置"}
          </div>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto workspace-scroll-area p-4 space-y-2">
          <button
            onClick={() => setActiveTab("generate")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-mono text-xs uppercase transition-colors ${
              activeTab === "generate"
                ? "bg-white/10 text-white"
                : "opacity-60 hover:opacity-100 hover:bg-white/5"
            }`}
          >
            <ImageIcon className="w-4 h-4" /> 生成
          </button>

          <button
            onClick={() => setActiveTab("history")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-mono text-xs uppercase transition-colors ${
              activeTab === "history"
                ? "bg-white/10 text-white"
                : "opacity-60 hover:opacity-100 hover:bg-white/5"
            }`}
          >
            <HistoryIcon className="w-4 h-4" /> 历史
          </button>

          <button
            onClick={() => setActiveTab("commerce")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-mono text-xs uppercase transition-colors ${
              activeTab === "commerce"
                ? "bg-white/10 text-white"
                : "opacity-60 hover:opacity-100 hover:bg-white/5"
            }`}
          >
            <BriefcaseBusiness className="w-4 h-4" /> 商业工作台
          </button>
        </nav>

        <div className="p-4 border-t border-white/10">
          <button
            onClick={() => void onLogout()}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg font-mono text-xs uppercase opacity-60 hover:opacity-100 hover:bg-white/5 transition-colors text-red-300"
          >
            <LogOut className="w-4 h-4" /> 退出登录
          </button>
        </div>
      </aside>

      <main className="flex-1 min-h-0 overflow-hidden relative flex flex-col workspace-scroll-lock">
        <div className={activeTab === "generate" ? "block h-full min-h-0 overflow-hidden" : "hidden"}>
          <Generator
            isVisible={activeTab === "generate"}
            credits={profile?.credits ?? null}
            onGenerationDone={onRefreshProfile}
            previewSize={previewSize}
            onPreviewSizeChange={setPreviewSize}
          />
        </div>

        {activeTab === "history" && (
          <div className="h-full min-h-0 overflow-hidden">
            <History
            previewSize={previewSize}
            onPreviewSizeChange={setPreviewSize}
          />
          </div>
        )}

        <div className={activeTab === "commerce" ? "block h-full min-h-0 overflow-hidden" : "hidden"}>
          <CommerceWorkspace
            onRefreshProfile={onRefreshProfile}
            previewSize={previewSize}
            onPreviewSizeChange={setPreviewSize}
          />
        </div>
      </main>
    </div>
  );
}
