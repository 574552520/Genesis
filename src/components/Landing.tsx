import React from "react";
import { ArrowUpRight, Hexagon, Search, ShoppingBag } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { ViewState } from "../types";

export default function Landing({
  onNavigate,
  user,
}: {
  onNavigate: (v: ViewState) => void;
  user: User | null;
}) {
  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <div
        className="absolute inset-0 z-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage:
            'url("https://images.unsplash.com/photo-1551582045-6ec9c11d8697?q=80&w=2000&auto=format&fit=crop")',
          backgroundSize: "cover",
          backgroundPosition: "center",
          mixBlendMode: "overlay",
        }}
      />

      <nav className="relative z-10 flex items-center justify-between p-6 border-b border-white/10">
        <div className="flex items-center gap-2 font-display text-2xl tracking-wider">
          <Hexagon className="w-6 h-6" />
          GNSIS
        </div>
        <div className="hidden md:flex items-center gap-8 font-mono text-sm tracking-widest uppercase opacity-80">
          <button className="hover:opacity-100 transition-opacity">目录</button>
          <button className="hover:opacity-100 transition-opacity">协议</button>
          <button className="hover:opacity-100 transition-opacity">关于</button>
        </div>
        <div className="flex items-center gap-4">
          <Search className="w-5 h-5 opacity-70 hover:opacity-100 cursor-pointer" />
          <ShoppingBag className="w-5 h-5 opacity-70 hover:opacity-100 cursor-pointer" />
          <button
            onClick={() => (user ? onNavigate("dashboard") : onNavigate("auth"))}
            className="ml-4 px-4 py-2 border border-white/30 rounded-full font-mono text-sm uppercase hover:bg-white hover:text-[#647B8C] transition-colors"
          >
            {user ? "控制台" : "登录"}
          </button>
        </div>
      </nav>

      <main className="flex-1 relative z-10 flex flex-col">
        <div className="p-6 md:p-12 grid grid-cols-1 md:grid-cols-12 gap-8">
          <div className="md:col-span-5 flex flex-col justify-center">
            <div className="font-mono text-sm tracking-widest uppercase opacity-65 mb-4">
              [ GENESIS STAGE 01 ] [ CORE ]
            </div>
            <h1 className="font-display text-7xl md:text-9xl leading-[0.85] tracking-tight mb-6 uppercase">
              Genesis
              <br />
              协议
            </h1>

            <div className="grid grid-cols-2 gap-4 font-mono text-sm uppercase opacity-80 mb-12 border-t border-b border-white/10 py-4">
              <div>
                <span className="block opacity-50 mb-1">类型</span>
                GENESIS CORE
              </div>
              <div>
                <span className="block opacity-50 mb-1">引擎</span>
                GEMINI 3 PRO
              </div>
            </div>

            <button
              onClick={() => (user ? onNavigate("dashboard") : onNavigate("auth"))}
              className="group flex items-center justify-between w-full max-w-sm border border-white/30 p-1 rounded-full hover:bg-white/10 transition-colors"
            >
              <div className="w-12 h-12 rounded-full border border-white/30 flex items-center justify-center group-hover:bg-white group-hover:text-[#647B8C] transition-colors">
                <ArrowUpRight className="w-5 h-5" />
              </div>
              <span className="font-mono text-sm tracking-widest uppercase pr-6">
                开始生成
              </span>
            </button>
          </div>

          <div className="md:col-span-7 relative h-[50vh] md:h-auto">
            <div className="absolute inset-0 rounded-2xl overflow-hidden border border-white/10 bg-[#3A4A54]/50 backdrop-blur-sm flex items-center justify-center">
              <img
                src="/landing-right-hero.png"
                alt="首页主视觉"
                className="w-full h-full object-cover opacity-80 mix-blend-luminosity"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src =
                    "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop";
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#647B8C] via-transparent to-transparent" />
              <h2 className="absolute bottom-6 left-6 font-display text-4xl opacity-50">
                AURORA
              </h2>
            </div>
          </div>
        </div>

        <div className="mt-auto p-6 border-t border-white/10 flex justify-between items-end">
          <h3 className="font-display text-4xl md:text-6xl uppercase max-w-2xl leading-none opacity-80">
            为创意而生
            <br />
            快速迭代
            <br />
            像素化创作
          </h3>
          <div className="font-mono text-xs text-right opacity-60 uppercase max-w-xs hidden md:block">
            GNSIS 因需求而生。[ 协议：ALTITUDE 001.01 ]
          </div>
        </div>
      </main>
    </div>
  );
}
