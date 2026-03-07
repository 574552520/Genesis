import React, { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Landing from "./components/Landing";
import Auth from "./components/Auth";
import Dashboard from "./components/Dashboard";
import { api } from "./lib/api";
import { supabase } from "./lib/supabase";
import type { UserProfile, ViewState } from "./types";

export default function App() {
  const [view, setView] = useState<ViewState>("landing");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    if (!session) return;
    try {
      const next = await api.getMe();
      setProfile(next);
      setBootstrapError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载账户信息失败";
      if (message.toLowerCase().includes("invalid or expired token")) {
        setProfile(null);
        setBootstrapError("本地登录状态已失效，请重新登录。");
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        return;
      }
      throw error;
    }
  }, [session]);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        setBootstrapError(null);
        const params = new URLSearchParams(window.location.search);
        const tokenHash = params.get("token_hash");
        const rawType = params.get("type");

        if (tokenHash && rawType) {
          const otpTypes = ["signup", "invite", "recovery", "email_change"] as const;
          if (otpTypes.includes(rawType as (typeof otpTypes)[number])) {
            await supabase.auth.verifyOtp({
              token_hash: tokenHash,
              type: rawType as (typeof otpTypes)[number],
            });
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        }

        const {
          data: { session: initialSession },
        } = await supabase.auth.getSession();
        if (!mounted) return;

        setSession(initialSession);
        if (initialSession) {
          try {
            const next = await api.getMe();
            if (!mounted) return;
            setProfile(next);
            setView("dashboard");
          } catch (error) {
            if (!mounted) return;
            const message = error instanceof Error ? error.message : "会话初始化失败";
            setProfile(null);
            setSession(null);
            setView("landing");
            setBootstrapError(
              message.toLowerCase().includes("invalid or expired token")
                ? "本地登录状态已失效，请重新登录。"
                : "会话初始化失败，请检查网络或 Supabase 配置后刷新重试。",
            );
            await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
          }
        } else {
          setView("landing");
        }
      } catch (error) {
        if (!mounted) return;
        console.error("Failed to bootstrap Supabase session", error);
        setSession(null);
        setProfile(null);
        setView("landing");
        setBootstrapError("会话初始化失败，请检查网络或 Supabase 配置后刷新重试。");
        // Clear local token cache when refresh flow fails to avoid lock-up on reload.
        void supabase.auth.signOut({ scope: "local" });
      } finally {
        if (mounted) {
          setBootstrapping(false);
        }
      }
    };

    void init();

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) {
        setView("dashboard");
      } else {
        setProfile(null);
        setView("landing");
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    void refreshProfile().catch((error) => {
      console.error("Failed to refresh profile", error);
    });
  }, [session, refreshProfile]);

  useEffect(() => {
    const body = document.body;
    if (view === "dashboard") {
      body.classList.add("dashboard-scroll-lock");
    } else {
      body.classList.remove("dashboard-scroll-lock");
    }

    return () => {
      body.classList.remove("dashboard-scroll-lock");
    };
  }, [view]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-[#647B8C] text-white font-sans flex items-center justify-center">
        <div className="font-mono text-xs uppercase opacity-70">正在加载会话...</div>
      </div>
    );
  }

  return (
    <div className={view === "dashboard"
      ? "h-full min-h-0 bg-[#647B8C] text-white font-sans selection:bg-white selection:text-[#647B8C]"
      : "min-h-screen bg-[#647B8C] text-white font-sans selection:bg-white selection:text-[#647B8C]"}>
      {view === "landing" && <Landing onNavigate={setView} user={session?.user ?? null} />}
      {view === "landing" && bootstrapError && (
        <div className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,640px)] -translate-x-1/2 rounded-md border border-white/30 bg-black/40 px-4 py-3 text-sm text-white/90 backdrop-blur-sm">
          {bootstrapError}
        </div>
      )}
      {view === "auth" && <Auth onBack={() => setView("landing")} />}
      {view === "dashboard" && session && (
        <Dashboard
          profile={profile}
          userEmail={session.user.email ?? ""}
          onRefreshProfile={refreshProfile}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
