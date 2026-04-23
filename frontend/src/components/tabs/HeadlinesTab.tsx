import { useCallback } from "react";
import { ExternalLink, Newspaper } from "lucide-react";

import { getHeadlines } from "@/services/api";
import { useApi } from "@/hooks/useApi";
import { LoadingOverlay } from "@/components/ui/spinner";
import { formatDate } from "@/lib/utils";

export function HeadlinesTab() {
  const fetcher = useCallback(() => getHeadlines(), []);
  const { data: headlines, loading, error } = useApi(fetcher);

  if (loading) return <LoadingOverlay label="Loading headlines..." />;
  if (error)   return <p className="text-rose-500 py-8 text-center">{error}</p>;
  if (!headlines || headlines.length === 0) {
    return <p className="text-[#1A1A1A]/40 py-8 text-center">No headlines available.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Page title */}
      <div className="flex items-center gap-2 mb-2">
        <Newspaper className="w-4 h-4 text-[#C4788A]" />
        <div>
          <h2 className="text-lg font-semibold text-[#1A1A1A] leading-tight">Headlines</h2>
          <p className="text-xs text-[#1A1A1A]/40 uppercase tracking-wide">Creator industry news</p>
        </div>
      </div>

      {headlines.map((headline, idx) => (
        <div
          key={idx}
          className="bg-white border border-[#1A1A1A]/8 border-l-[3px] border-l-[#C4788A] rounded-xl p-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {/* Source + date */}
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-full bg-[#F5EEF0] text-[#8B4A5C] font-medium border border-[#EAC5CC]">
                  {headline.source}
                </span>
                <span className="text-xs text-[#1A1A1A]/30">{formatDate(headline.fetched_at)}</span>
              </div>

              {/* Title */}
              <h3 className="text-[#1A1A1A] font-semibold text-sm leading-snug mb-2">
                {headline.title}
              </h3>

              {/* Description */}
              {headline.summary && (
                <p className="text-[#1A1A1A]/50 text-xs leading-relaxed line-clamp-2">
                  {headline.summary}
                </p>
              )}
            </div>

            {/* Link icon */}
            <a
              href={headline.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#1A1A1A]/30 hover:text-[#C4788A] transition-colors flex-shrink-0 mt-1"
              aria-label="Open article"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
