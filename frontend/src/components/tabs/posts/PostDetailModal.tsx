import { useEffect, useState, type ReactNode } from "react";
import {
  X, Heart, Bookmark, Share2, Eye, Film, Sparkles,
  MessageCircle, TrendingUp, Calendar,
} from "lucide-react";

import { analyzePost, savePostAnalysis } from "@/services/api";
import { MediaBadge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { formatNumber } from "@/lib/utils";
import type { AccountAverages, Post } from "@/types";

// ── Minimal markdown renderer: handles **bold**, strips # headers, preserves newlines ──

function renderInline(text: string): ReactNode[] {
  // Split on **...** pairs
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} className="font-semibold text-[#6B2A3A]">{part.slice(2, -2)}</strong>
      : part
  );
}

function SimpleMarkdown({ text }: { text: string }) {
  // Strip leading # headers, then split into paragraphs/lines
  const cleaned = text
    .replace(/^#{1,3}\s+/gm, "")   // remove # ## ### at line start
    .replace(/\*(?!\*)/g, "")       // remove lone * (italic) — keep **bold**
    .trim();

  const blocks = cleaned.split(/\n{2,}/);

  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        // Bullet list block
        if (block.trim().startsWith("- ") || block.trim().startsWith("• ")) {
          const items = block.split("\n").filter(Boolean);
          return (
            <ul key={i} className="space-y-1 pl-3">
              {items.map((item, j) => (
                <li key={j} className="flex gap-1.5">
                  <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-[#C4788A]" />
                  <span>{renderInline(item.replace(/^[-•]\s*/, ""))}</span>
                </li>
              ))}
            </ul>
          );
        }
        // Regular paragraph — preserve single newlines as line breaks
        const lines = block.split("\n");
        return (
          <p key={i}>
            {lines.map((line, j) => (
              <span key={j}>
                {renderInline(line)}
                {j < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

interface Props {
  post: Post;
  averages: AccountAverages;
  onClose: () => void;
  onAnalysisSaved: (post_id: string, analysis: string, isFinal: boolean) => void;
}

export function PostDetailModal({ post, averages, onClose, onAnalysisSaved }: Props) {
  const [analysis, setAnalysis]               = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError]     = useState<string | null>(null);

  const er = post.reach > 0
    ? ((post.like_count + post.comments_count) / post.reach) * 100
    : 0;

  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Analysis caching rules:
  // < 24h   → "come back tomorrow" — no API call, no DB save, free
  // 24-72h  → generate with early disclaimer, save is_final=false
  // > 72h + is_final=false in DB → regenerate once as final, save is_final=true
  // > 72h + is_final=true  in DB → show cached forever, no API call
  useEffect(() => {
    setAnalysisError(null);

    const postAgeHours = (Date.now() - new Date(post.timestamp).getTime()) / (1000 * 60 * 60);

    // Case: final analysis already in DB — show instantly, never regenerate
    if (post.ai_analysis && post.analysis_is_final === true) {
      setAnalysis(post.ai_analysis);
      setAnalysisLoading(false);
      return;
    }

    // Case: early analysis in DB and post is still < 72h — show as-is, no new call
    if (post.ai_analysis && post.analysis_is_final === false && postAgeHours < 72) {
      setAnalysis(post.ai_analysis);
      setAnalysisLoading(false);
      return;
    }

    // Case: post < 24h old — show waiting message, no API call, no DB save
    if (postAgeHours < 24) {
      const hours = Math.max(1, Math.floor(postAgeHours));
      const unit = hours === 1 ? "hour" : "hours";
      setAnalysis(
        `This post is only ${hours} ${unit} old — come back tomorrow for a real read on how it's performing. ` +
        `Instagram distributes content over 24-48 hours so early numbers don't tell the full story.`
      );
      setAnalysisLoading(false);
      return;
    }

    // Remaining cases: call Claude
    // - 24-72h, no analysis yet → generate early (is_final=false)
    // - > 72h, early analysis exists → regenerate final (is_final=true)
    // - > 72h, no analysis yet → generate final (is_final=true)
    const willBeFinal = postAgeHours >= 72;

    let cancelled = false;
    setAnalysis(null);
    setAnalysisLoading(true);

    analyzePost({
      metrics: {
        media_type: post.media_type,
        caption: post.caption ?? "",
        timestamp: post.timestamp,
        reach: post.reach,
        likes: post.like_count,
        saves: post.saved,
        shares: post.shares,
        comments: post.comments_count,
        engagement_rate: parseFloat(er.toFixed(2)),
        ...(post.views != null ? { views: post.views } : {}),
      },
      averages,
    })
      .then((r) => {
        if (cancelled) return;
        setAnalysis(r.analysis);
        setAnalysisLoading(false);
        // Update in-session cache immediately
        onAnalysisSaved(post.post_id, r.analysis, willBeFinal);
        // Persist to DB — fire and forget, silent on failure
        savePostAnalysis(post.post_id, r.analysis, willBeFinal).catch(() => {});
      })
      .catch(() => {
        if (!cancelled) {
          setAnalysisError("Could not generate analysis — try again later.");
          setAnalysisLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [post.post_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const formattedDate = new Date(post.timestamp).toLocaleDateString("en-CA", {
    year: "numeric", month: "short", day: "numeric",
  });

  const erClass = er > 8
    ? "text-emerald-500"
    : er >= 4
    ? "text-amber-500"
    : "text-rose-400";

  const METRICS = [
    { icon: Heart,         label: "Likes",    value: formatNumber(post.like_count),                                       color: "text-rose-400"    },
    { icon: Bookmark,      label: "Saves",    value: formatNumber(post.saved),                                             color: "text-emerald-500" },
    { icon: Share2,        label: "Shares",   value: formatNumber(post.shares),                                            color: "text-sky-500"     },
    { icon: Eye,           label: "Reach",    value: formatNumber(post.reach),                                             color: "text-violet-400"  },
    { icon: Film,          label: "Views",    value: post.views != null ? formatNumber(post.views) : "—",                  color: "text-amber-500"   },
    { icon: Sparkles,      label: "Impr.",    value: post.impressions != null ? formatNumber(post.impressions) : "—",      color: "text-pink-400"    },
    { icon: MessageCircle, label: "Comments", value: formatNumber(post.comments_count),                                    color: "text-blue-400"    },
    { icon: TrendingUp,    label: "ER",       value: `${er.toFixed(1)}%`,                                                 color: erClass            },
  ] as const;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[95vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-y-auto flex-1">
          {/* Thumbnail */}
          <div className="relative aspect-square w-full bg-[#F5EEF0]">
            {post.thumbnail_url ? (
              <img
                src={post.thumbnail_url}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-12 h-12 rounded-full bg-[#EAC5CC]/50" />
              </div>
            )}
            <button
              onClick={onClose}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Meta row */}
            <div className="flex items-center justify-between">
              <MediaBadge type={post.media_type} />
              <span className="flex items-center gap-1 text-xs text-[#1A1A1A]/40">
                <Calendar className="w-3 h-3" />
                {formattedDate}
              </span>
            </div>

            {/* Caption */}
            <p className="text-sm text-[#1A1A1A]/80 leading-relaxed">
              {post.caption || <span className="italic text-[#1A1A1A]/30">No caption</span>}
            </p>

            {/* Metrics grid */}
            <div>
              <p className="text-[10px] font-semibold text-[#1A1A1A]/30 uppercase tracking-wider mb-2">
                Performance
              </p>
              <div className="grid grid-cols-4 gap-2">
                {METRICS.map(({ icon: Icon, label, value, color }) => (
                  <div key={label} className="bg-[#F5EEF0] rounded-xl p-2.5 text-center">
                    <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
                    <p className="text-sm font-semibold text-[#1A1A1A]">{value}</p>
                    <p className="text-[10px] text-[#1A1A1A]/40 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Analysis */}
            <div className="bg-[#F5EEF0] border border-[#EAC5CC] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2.5">
                <Sparkles className="w-4 h-4 text-[#8B4A5C]" />
                <span className="text-xs font-semibold text-[#6B2A3A]">AI Analysis</span>
              </div>

              {analysisLoading ? (
                <div className="flex items-center gap-2 text-xs text-[#8B4A5C]/60">
                  <Spinner />
                  <span>Analyzing performance…</span>
                </div>
              ) : analysisError ? (
                <p className="text-xs text-rose-400">{analysisError}</p>
              ) : analysis ? (
                <div className="text-xs text-[#8B4A5C]/80 leading-relaxed">
                  <SimpleMarkdown text={analysis} />
                </div>
              ) : null}
            </div>

            {/* Bottom padding for mobile scroll */}
            <div className="h-2" />
          </div>
        </div>
      </div>
    </div>
  );
}
