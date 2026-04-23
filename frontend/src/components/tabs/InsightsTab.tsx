import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Star, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";

import { generateInsights, getInsights, getFormatPerformance, getPostingHeatmap } from "@/services/api";
import { useApi } from "@/hooks/useApi";
import { LoadingOverlay, Spinner } from "@/components/ui/spinner";
import { formatDateTime, nextMondayDisplay } from "@/lib/utils";
import { FormatPerformanceTable } from "@/components/tabs/FormatPerformanceTable";
import { PostingHeatmap } from "@/components/tabs/insights/PostingHeatmap";
import type { InsightItem } from "@/types";

/** Render markdown with **bold** as proper HTML. */
function Markdown({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\n+/).filter(Boolean).map((para, i) => (
        <p key={i} className="mb-3 last:mb-0">
          {para.split(/(\*\*[^*]+\*\*)/).map((chunk, j) =>
            chunk.startsWith("**") && chunk.endsWith("**")
              ? <strong key={j}>{chunk.slice(2, -2)}</strong>
              : <span key={j}>{chunk}</span>
          )}
        </p>
      ))}
    </>
  );
}

/** Extract up to 3 bullet points from prose text. */
function toBullets(text: string): string[] {
  const byNewline = text.split(/\n+/).map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  if (byNewline.length >= 2) return byNewline.slice(0, 3);
  return text.split(/\.\s+/).filter(Boolean).slice(0, 3).map((s) => s.trim().replace(/\.$/, "") + ".");
}

function toInsightItems(field: InsightItem[] | string): InsightItem[] {
  if (Array.isArray(field)) return field;
  return toBullets(field).map((bullet) => ({ title: "", insight: bullet }));
}

const WORKING_TAGS  = ["Reels", "Skincare", "Tutorials"];
const FLOPPING_TAGS = ["Static posts", "Long captions", "Promos"];

// ─── Main component ───────────────────────────────────────────────────────────

export function InsightsTab() {
  const fetcher       = useCallback(() => getInsights(), []);
  const fpFetcher     = useCallback(() => getFormatPerformance(), []);
  const heatmapFetch  = useCallback(() => getPostingHeatmap(), []);
  const { data: insights, loading, error, refetch } = useApi(fetcher);
  const { data: formatPerf  } = useApi(fpFetcher);
  const { data: heatmapData } = useApi(heatmapFetch);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError]     = useState<string | null>(null);
  const [callsUsed, setCallsUsed]   = useState<number | null>(null);

  const rateLimitDate = callsUsed === 3 ? nextMondayDisplay() : null;

  async function handleGenerate() {
    setGenerating(true);
    setGenError(null);
    try {
      const result = await generateInsights();
      if (result.calls_used !== undefined) setCallsUsed(result.calls_used);
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("429")) {
        setCallsUsed(3);
      } else {
        setGenError(msg || "Failed to generate insights");
      }
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    if (insights?.calls_used !== undefined) setCallsUsed(insights.calls_used);
  }, [insights]);

  if (loading) return <LoadingOverlay label="Loading insights..." />;
  if (error)   return <p className="text-rose-500 py-8 text-center">{error}</p>;
  if (!insights) return null;

  const workingItems  = toInsightItems(insights.what_working);
  const floppingItems = toInsightItems(insights.what_flopping);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#1A1A1A]/40">
          Generated {formatDateTime(insights.generated_at)}
        </p>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 text-xs text-[#1A1A1A]/50 hover:text-[#1A1A1A] transition-colors px-3 py-1.5 rounded-lg border border-[#1A1A1A]/10 hover:border-[#1A1A1A]/20 disabled:opacity-40"
          >
            {generating ? <Spinner className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
            Regenerate
          </button>
          {callsUsed !== null && (
            <span className="text-[10px] text-[#1A1A1A]/30">{callsUsed}/3 refreshes used this week</span>
          )}
        </div>
      </div>

      {genError && <p className="text-rose-500 text-sm">{genError}</p>}

      {rateLimitDate && (
        <div className="flex items-center gap-2 text-xs text-[#6B2A3A] bg-[#F5EEF0] px-3 py-2.5 rounded-lg border border-[#EAC5CC]">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-[#C4788A]" />
          Insights refreshed 3 times this week. Next refresh available {rateLimitDate}.
        </div>
      )}

      {insights.source === "mock" && (
        <div className="flex items-center gap-2 text-xs text-amber-700/80 bg-amber-50 px-3 py-2.5 rounded-lg border border-amber-200/70">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
          These are sample insights. Click <strong className="font-medium ml-1">Regenerate</strong> to generate a real analysis.
        </div>
      )}

      {/* What's Working / What's Flopping — 2-col grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Working */}
        <div className="bg-white border border-[#1A1A1A]/8 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <span className="text-sm font-semibold text-emerald-700">What's Working</span>
          </div>
          <ul className="space-y-2.5 mb-3">
            {workingItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2 leading-snug">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                <span>
                  {item.title && <span className="text-xs font-semibold text-[#1A1A1A]/80">{item.title} — </span>}
                  <span className="text-xs text-[#1A1A1A]/60">{item.insight}</span>
                  {item.next_step && (
                    <p className="text-xs text-[#1A1A1A]/40 mt-0.5">→ {item.next_step}</p>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            {WORKING_TAGS.map((tag) => (
              <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-[#ecfdf5] text-[#065f46] font-medium">
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Flopping */}
        <div className="bg-white border border-[#1A1A1A]/8 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="w-4 h-4 text-rose-500" />
            <span className="text-sm font-semibold text-rose-600">What's Flopping</span>
          </div>
          <ul className="space-y-2.5 mb-3">
            {floppingItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2 leading-snug">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-1.5 shrink-0" />
                <span>
                  {item.title && <span className="text-xs font-semibold text-[#1A1A1A]/80">{item.title} — </span>}
                  <span className="text-xs text-[#1A1A1A]/60">{item.insight}</span>
                  {item.next_step && (
                    <p className="text-xs text-[#1A1A1A]/40 mt-0.5">→ {item.next_step}</p>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            {FLOPPING_TAGS.map((tag) => (
              <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-[#fff1f2] text-[#9f1239] font-medium">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Weekly AI Briefing — mauve hero card */}
      <div className="bg-[#F5EEF0] border border-[#EAC5CC] rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Star className="w-4 h-4 text-[#C4788A]" />
          <span className="text-sm font-semibold text-[#6B2A3A]">Weekly AI Briefing</span>
        </div>
        <div className="text-sm text-[#8B4A5C] leading-relaxed">
          <Markdown text={insights.briefing} />
        </div>
      </div>

      {/* Content Type Performance */}
      {heatmapData && heatmapData.length > 0 && <PostingHeatmap slots={heatmapData} />}

      {formatPerf && <FormatPerformanceTable rows={formatPerf} />}
    </div>
  );
}
