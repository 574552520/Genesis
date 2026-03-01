import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Hexagon } from "lucide-react";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        callback: (token: string) => void;
        "expired-callback"?: () => void;
        "error-callback"?: () => void;
      }) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const turnstileSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? "";

export default function Auth({ onBack }: { onBack: () => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const captchaContainerRef = useRef<HTMLDivElement | null>(null);
  const captchaWidgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!turnstileSiteKey) {
      return;
    }

    let cancelled = false;

    const renderWidget = () => {
      if (cancelled || !captchaContainerRef.current || !window.turnstile) {
        return;
      }

      if (captchaWidgetIdRef.current) {
        window.turnstile.remove(captchaWidgetIdRef.current);
        captchaWidgetIdRef.current = null;
      }

      captchaWidgetIdRef.current = window.turnstile.render(captchaContainerRef.current, {
        sitekey: turnstileSiteKey,
        callback: (token: string) => {
          setCaptchaToken(token);
          setError(null);
        },
        "expired-callback": () => {
          setCaptchaToken(null);
        },
        "error-callback": () => {
          setCaptchaToken(null);
          setError("验证码校验失败，请重试。");
        },
      });
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile="true"]');
    if (existing) {
      renderWidget();
    } else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = "true";
      script.onload = renderWidget;
      script.onerror = () => {
        setError("验证码组件加载失败，请刷新页面后重试。");
      };
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (window.turnstile && captchaWidgetIdRef.current) {
        window.turnstile.remove(captchaWidgetIdRef.current);
      }
      captchaWidgetIdRef.current = null;
    };
  }, []);

  const resetCaptcha = () => {
    setCaptchaToken(null);
    if (window.turnstile && captchaWidgetIdRef.current) {
      window.turnstile.reset(captchaWidgetIdRef.current);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      if (turnstileSiteKey) {
        if (!captchaToken) {
          throw new Error("请先完成人机验证。");
        }
        await api.verifyTurnstile(captchaToken);
      }

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
          options: {
            emailRedirectTo: window.location.origin,
          },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setMessage("注册成功，请先前往邮箱完成验证。");
        } else {
          setMessage("注册成功。");
        }
      }

      if (turnstileSiteKey) {
        resetCaptcha();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "认证失败，请稍后重试。");
      if (turnstileSiteKey) {
        resetCaptcha();
      }
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
        <ArrowLeft className="w-4 h-4" /> 返回
      </button>

      <div className="w-full max-w-md border border-white/20 bg-[#3A4A54]/30 backdrop-blur-md p-8 rounded-2xl">
        <div className="flex justify-center mb-8">
          <Hexagon className="w-12 h-12 opacity-80" />
        </div>

        <h2 className="font-display text-4xl uppercase text-center mb-2">
          {isLogin ? "登录" : "注册"}
        </h2>
        <p className="font-mono text-xs text-center opacity-50 uppercase mb-8">
          [ SYSTEM: {isLogin ? "身份验证" : "注册流程"} ]
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block font-mono text-[10px] uppercase opacity-70 mb-2">邮箱</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-transparent border-b border-white/30 px-0 py-2 font-mono text-sm focus:outline-none focus:border-white transition-colors"
              placeholder="请输入邮箱"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase opacity-70 mb-2">密码</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-transparent border-b border-white/30 px-0 py-2 font-mono text-sm focus:outline-none focus:border-white transition-colors"
              placeholder="至少 6 位字符"
            />
          </div>

          {turnstileSiteKey && (
            <div>
              <label className="block font-mono text-[10px] uppercase opacity-70 mb-2">人机验证</label>
              <div ref={captchaContainerRef} className="min-h-[68px]" />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-[#647B8C] font-mono text-sm uppercase py-3 rounded-full hover:bg-opacity-90 transition-colors mt-4 disabled:opacity-60"
          >
            {loading ? "处理中..." : isLogin ? "进入系统" : "创建账号"}
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
            onClick={() => {
              setIsLogin((v) => !v);
              setError(null);
              setMessage(null);
              if (turnstileSiteKey) {
                resetCaptcha();
              }
            }}
            className="font-mono text-xs uppercase opacity-50 hover:opacity-100 transition-opacity"
          >
            {isLogin ? "还没有账号？去注册" : "已有账号？去登录"}
          </button>
        </div>
      </div>
    </div>
  );
}
