import React, { useState } from "react";
import { ArrowLeft, Hexagon } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function Auth({ onBack }: { onBack: () => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      if (isLogin) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
      } else {
        const { error: signUpError, data } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setMessage("Registration complete. Please verify your email before login.");
        } else {
          setMessage("Registration complete.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 relative">
      <button
        onClick={onBack}
        className="absolute top-6 left-6 flex items-center gap-2 font-mono text-xs uppercase opacity-70 hover:opacity-100"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="w-full max-w-md border border-white/20 bg-[#3A4A54]/30 backdrop-blur-md p-8 rounded-2xl">
        <div className="flex justify-center mb-8">
          <Hexagon className="w-12 h-12 opacity-80" />
        </div>

        <h2 className="font-display text-4xl uppercase text-center mb-2">
          {isLogin ? "Sign In" : "Sign Up"}
        </h2>
        <p className="font-mono text-xs text-center opacity-50 uppercase mb-8">
          [ SYSTEM: {isLogin ? "AUTHENTICATION" : "REGISTRATION"} ]
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block font-mono text-[10px] uppercase opacity-70 mb-2">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-transparent border-b border-white/30 px-0 py-2 font-mono text-sm focus:outline-none focus:border-white transition-colors"
              placeholder="your@email.com"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase opacity-70 mb-2">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-transparent border-b border-white/30 px-0 py-2 font-mono text-sm focus:outline-none focus:border-white transition-colors"
              placeholder="Minimum 6 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-[#647B8C] font-mono text-sm uppercase py-3 rounded-full hover:bg-opacity-90 transition-colors mt-4 disabled:opacity-60"
          >
            {loading ? "Processing..." : isLogin ? "Enter System" : "Create Account"}
          </button>
        </form>

        {message && (
          <div className="mt-4 p-3 rounded-lg border border-emerald-300/40 bg-emerald-500/20 font-mono text-xs">
            {message}
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 rounded-lg border border-red-300/40 bg-red-500/20 font-mono text-xs">
            {error}
          </div>
        )}

        <div className="mt-8 text-center">
          <button
            onClick={() => setIsLogin((v) => !v)}
            className="font-mono text-xs uppercase opacity-50 hover:opacity-100 transition-opacity"
          >
            {isLogin ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
