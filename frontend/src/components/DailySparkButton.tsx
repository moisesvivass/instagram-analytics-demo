import { useState } from "react";
import { X } from "lucide-react";
import { getDailySpark } from "@/services/api";

const STORAGE_KEY = "demo_daily_spark";

function getCachedSpark(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { date: string; message: string };
    const today = new Date().toISOString().slice(0, 10);
    return parsed.date === today ? parsed.message : null;
  } catch {
    return null;
  }
}

function cacheSpark(message: string): void {
  try {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, message }));
  } catch {
    // localStorage unavailable — not critical
  }
}

export function DailySparkButton() {
  const [open, setOpen]       = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(false);

  async function handleOpen() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setError(false);
    const cached = getCachedSpark();
    if (cached) { setMessage(cached); return; }
    setLoading(true);
    setMessage(null);
    try {
      const data = await getDailySpark();
      cacheSpark(data.message);
      setMessage(data.message);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      {/* Trigger button — lives in the header */}
      <button
        onClick={handleOpen}
        aria-label="Daily Spark"
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-white text-xs font-medium transition-all hover:scale-105 active:scale-95"
        style={{
          background: "linear-gradient(135deg, #C4788A 0%, #a85a6e 100%)",
          boxShadow: "0 2px 10px rgba(196,120,138,0.40)",
        }}
      >
        <span className="text-sm leading-none">♡</span>
        <span className="hidden sm:inline">Daily Spark</span>
      </button>

      {/* Dropdown card — anchored to button */}
      {open && (
        <div
          className="absolute top-full right-0 mt-2 w-80 rounded-2xl border border-[#EAC5CC]/60 shadow-xl p-6 z-50"
          style={{
            background: "linear-gradient(160deg, #FDF0F2 0%, #FFFBFC 60%, #ffffff 100%)",
            boxShadow: "0 12px 40px rgba(196,120,138,0.18), 0 2px 8px rgba(0,0,0,0.06)",
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <span
              className="text-base text-[#C4788A]"
              style={{ fontFamily: "'Playfair Display', Georgia, serif", fontStyle: "italic" }}
            >
              Daily Spark
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-[#1A1A1A]/25 hover:text-[#1A1A1A]/50 transition-colors"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {loading && (
            <div className="flex gap-1.5 py-3">
              <span className="w-1.5 h-1.5 rounded-full bg-[#C4788A]/40 animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#C4788A]/40 animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#C4788A]/40 animate-bounce [animation-delay:300ms]" />
            </div>
          )}

          {error && (
            <p className="text-sm text-[#1A1A1A]/40 italic">
              Couldn't load today's message. Try again later.
            </p>
          )}

          {message && (
            <p
              className="text-[15px] leading-relaxed text-[#1A1A1A]/75 tracking-wide"
              style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
            >
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
