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

  const refreshProfile = useCallback(async () => {
    if (!session) return;
    const next = await api.getMe();
    setProfile(next);
  }, [session]);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const {
        data: { session: initialSession },
      } = await supabase.auth.getSession();
      if (!mounted) return;

      setSession(initialSession);
      if (initialSession) {
        setView("dashboard");
      } else {
        setView("landing");
      }
      setBootstrapping(false);
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
    void refreshProfile();
  }, [session, refreshProfile]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-[#647B8C] text-white font-sans flex items-center justify-center">
        <div className="font-mono text-xs uppercase opacity-70">Loading session...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#647B8C] text-white font-sans selection:bg-white selection:text-[#647B8C]">
      {view === "landing" && <Landing onNavigate={setView} user={session?.user ?? null} />}
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
