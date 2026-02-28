import React, { useEffect, useState } from "react";
import { Download, Trash2, Maximize2, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import ImageModal from "./ImageModal";
import type { GenerationRecord } from "../types";

function modelLabel(model: GenerationRecord["model"]): string {
  return model === "v2" ? "v2" : "Pro";
}

export default function History() {
  const [history, setHistory] = useState<GenerationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enlargedItem, setEnlargedItem] = useState<GenerationRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.listHistory(60, 0);
        setHistory(data.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load history");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const deleteItem = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await api.deleteGeneration(id);
      setHistory((prev) => prev.filter((item) => item.id !== id));
      if (enlargedItem?.id === id) setEnlargedItem(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete item");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-6 md:p-10 w-full">
      <header className="mb-10">
        <h1 className="font-display text-4xl md:text-5xl uppercase mb-2">Archive</h1>
        <p className="font-mono text-xs opacity-60 uppercase tracking-widest">
          [ PREVIOUS SYNTHESES ]
        </p>
      </header>

      {loading ? (
        <div className="text-center py-20 opacity-60 font-mono text-sm uppercase flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading history...
        </div>
      ) : error ? (
        <div className="text-center py-20 font-mono text-sm text-red-200">{error}</div>
      ) : history.length === 0 ? (
        <div className="text-center py-20 opacity-50 font-mono text-sm uppercase">
          No records found.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6">
          {history.map((item) => (
            <div
              key={item.id}
              className="group bg-[#3A4A54]/20 border border-white/10 rounded-xl overflow-hidden hover:border-white/30 transition-colors cursor-pointer flex flex-col"
              onClick={() => item.imageUrl && setEnlargedItem(item)}
            >
              <div className="aspect-square relative overflow-hidden bg-[#0a0f14]">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.prompt}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-90 group-hover:opacity-100"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-xs font-mono opacity-60 px-4 text-center">
                    {item.status === "failed" ? "Generation failed" : item.status}
                  </div>
                )}
                <div className="absolute top-2 left-2 px-2 py-1 rounded-full border border-white/30 bg-black/40 font-mono text-[10px] uppercase tracking-widest">
                  {modelLabel(item.model)}
                </div>
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                  {item.imageUrl && (
                    <>
                      <button
                        className="p-3 bg-white text-black rounded-full hover:scale-110 transition-transform"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEnlargedItem(item);
                        }}
                      >
                        <Maximize2 className="w-4 h-4" />
                      </button>
                      <a
                        href={item.imageUrl}
                        download={`genesis-${item.id}.png`}
                        className="p-3 bg-white text-black rounded-full hover:scale-110 transition-transform"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    </>
                  )}
                  <button
                    onClick={(e) => void deleteItem(e, item.id)}
                    disabled={deletingId === item.id}
                    className="p-3 bg-red-500 text-white rounded-full hover:scale-110 transition-transform disabled:opacity-60"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between">
                <p className="font-sans text-sm line-clamp-2 opacity-80 mb-3" title={item.prompt}>
                  {item.prompt || "No prompt provided"}
                </p>
                <p className="font-mono text-[10px] opacity-50 uppercase">
                  {new Date(item.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {enlargedItem?.imageUrl && (
        <ImageModal
          url={enlargedItem.imageUrl}
          prompt={enlargedItem.prompt}
          onClose={() => setEnlargedItem(null)}
        />
      )}
    </div>
  );
}
