import React from "react";
import { X, Download } from "lucide-react";

interface ImageModalProps {
  url: string;
  prompt?: string;
  onClose: () => void;
}

export default function ImageModal({ url, prompt, onClose }: ImageModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0f14]/90 p-4 md:p-8 backdrop-blur-md"
      onClick={onClose}
    >
      <button
        className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors border border-white/10"
        onClick={onClose}
      >
        <X className="w-6 h-6" />
      </button>

      <div
        className="relative max-w-full max-h-full flex flex-col items-center animate-in fade-in zoom-in duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={url}
          alt={prompt || "大图预览"}
          className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-[0_0_40px_rgba(0,0,0,0.5)] border border-white/10"
          referrerPolicy="no-referrer"
        />

        {prompt && (
          <div className="mt-6 text-center max-w-3xl bg-[#3A4A54]/50 border border-white/10 p-4 rounded-xl backdrop-blur-sm">
            <p className="font-sans text-sm opacity-90 leading-relaxed">{prompt}</p>
          </div>
        )}

        <a
          href={url}
          download="genesis-synthesis.png"
          className="mt-6 flex items-center gap-2 px-6 py-3 bg-white text-[#647B8C] rounded-full font-mono text-xs uppercase hover:bg-opacity-90 transition-colors shadow-lg"
        >
          <Download className="w-4 h-4" /> 下载图片
        </a>
      </div>
    </div>
  );
}
