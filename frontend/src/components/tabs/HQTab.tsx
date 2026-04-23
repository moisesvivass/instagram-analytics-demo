import { useCallback, useRef, useState } from "react";
import { Trash2, TrendingUp, Users, Zap, Target, RefreshCw, Upload, AlertTriangle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { getHQGlance, refreshHQGlance, importCsv, getFormatPerformance } from "@/services/api";
import { useApi } from "@/hooks/useApi";
import { usePinnedComments } from "@/hooks/usePinnedComments";
import { formatDateTime } from "@/lib/utils";
import { FormatPerformanceTable } from "@/components/tabs/FormatPerformanceTable";
import type { CsvImportResult } from "@/types";

function hoursAgo(isoString: string): string {
  const diff = (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60);
  if (diff < 1) return "just now";
  const h = Math.floor(diff);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

export function HQTab() {
  const { pinned, unpin } = usePinnedComments();
  const glanceFetcher = useCallback(() => getHQGlance(), []);
  const fpFetcher     = useCallback(() => getFormatPerformance(), []);
  const { data: glance, loading, error, refetch } = useApi(glanceFetcher);
  const { data: formatPerf } = useApi(fpFetcher);
  const [refreshing, setRefreshing]       = useState(false);
  const [refreshError, setRefreshError]   = useState<string | null>(null);

  async function handleForceRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await refreshHQGlance();
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setRefreshError(
        msg.includes("429") ? "Refresh limit reached (3/day). Try again tomorrow." : "Refresh failed."
      );
    } finally {
      setRefreshing(false);
    }
  }

  const fileInputRef  = useRef<HTMLInputElement>(null);
  const [importing, setImporting]       = useState(false);
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null);
  const [importError, setImportError]   = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const result = await importCsv(file);
      setImportResult(result);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      {/* Top 2-column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Content score card — mauve bg */}
        <div className="bg-[#F5EEF0] border border-[#EAC5CC] rounded-xl p-5">
          <p className="text-xs font-medium text-[#8B4A5C] uppercase tracking-wide mb-3">Content Score</p>
          <p className="text-5xl font-bold text-[#6B2A3A] leading-none mb-1">
            {glance ? "78" : "—"}
            <span className="text-2xl font-normal text-[#C4788A]">%</span>
          </p>
          <p className="text-xs text-[#8B4A5C]/70 mt-1">Above average for beauty creators</p>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8B4A5C]/60">Reach projection</span>
              <span className="font-semibold text-[#6B2A3A]">
                {glance ? "↑ +12% this week" : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8B4A5C]/60">Avg impressions</span>
              <span className="font-semibold text-[#6B2A3A]">
                {glance ? "4,200 / post" : "—"}
              </span>
            </div>
          </div>

          <div className="mt-3 h-1.5 bg-[#EAC5CC] rounded-full overflow-hidden">
            <div className="h-full bg-[#C4788A] rounded-full" style={{ width: "78%" }} />
          </div>
        </div>

        {/* Pinned insights */}
        <div className="bg-white border border-[#1A1A1A]/8 rounded-xl p-5">
          <p className="text-xs font-medium text-[#1A1A1A]/40 uppercase tracking-wide mb-3">Pinned Insights</p>

          {pinned.length === 0 ? (
            <p className="text-[#1A1A1A]/30 text-sm py-4 text-center">
              No pinned comments yet. Pin any comment from the Overview tab.
            </p>
          ) : (
            <div className="space-y-2.5">
              {pinned.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start justify-between gap-3 p-3 rounded-lg bg-[#1A1A1A]/4 border border-[#1A1A1A]/6"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#C4788A] shrink-0" />
                      <span className="text-[#8B4A5C] text-xs font-semibold">@{c.username}</span>
                      <span className="text-[#1A1A1A]/30 text-xs">{formatDateTime(c.pinned_at)}</span>
                    </div>
                    <p className="text-[#1A1A1A]/80 text-sm leading-snug">"{c.text}"</p>
                  </div>
                  <button
                    onClick={() => unpin(c.id)}
                    className="p-1.5 text-[#1A1A1A]/20 hover:text-rose-500 transition-colors rounded-lg hover:bg-[#1A1A1A]/5 shrink-0"
                    aria-label="Remove from HQ"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* This week at a glance */}
      <div className="bg-white border border-[#1A1A1A]/8 rounded-xl p-5">
        <div className="flex items-start justify-between mb-4 gap-2">
          <div>
            <p className="text-sm font-semibold text-[#1A1A1A]">This Week at a Glance</p>
            {glance?.generated_at && (
              <p className="text-[10px] text-[#1A1A1A]/30 mt-0.5">
                Generated {hoursAgo(glance.generated_at)}
              </p>
            )}
            {refreshError && (
              <p className="text-[10px] text-rose-400 mt-0.5">{refreshError}</p>
            )}
          </div>
          <button
            onClick={handleForceRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-[#1A1A1A]/40 hover:text-[#1A1A1A] transition-colors px-2 py-1 rounded-lg border border-[#1A1A1A]/10 hover:border-[#1A1A1A]/20 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {refreshing ? <Spinner /> : <RefreshCw className="w-3 h-3" />}
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {loading && <div className="flex justify-center py-6"><Spinner /></div>}
        {error   && <p className="text-rose-500 text-sm py-4 text-center">{error}</p>}

        {glance && !loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { icon: <TrendingUp className="w-4 h-4 text-[#C4788A]" />, label: "Top Post",             value: glance.top_post },
              { icon: <Users className="w-4 h-4 text-violet-400" />,     label: "Follower Growth",      value: glance.follower_growth },
              { icon: <Zap className="w-4 h-4 text-amber-400" />,        label: "Top Content Signal",   value: glance.top_signal },
              { icon: <Target className="w-4 h-4 text-emerald-400" />,   label: "Priority Action",      value: glance.priority_action },
            ].map(({ icon, label, value }) => (
              <div key={label} className="flex items-start gap-3 p-3 rounded-lg bg-[#1A1A1A]/4">
                <div className="mt-0.5 shrink-0">{icon}</div>
                <div>
                  <p className="text-[#1A1A1A]/40 text-xs uppercase tracking-wide mb-0.5">{label}</p>
                  <p className="text-[#1A1A1A]/90 text-sm leading-snug">{value}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Needs attention — red alert */}
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-rose-700 mb-1">Needs Attention</p>
          <p className="text-xs text-rose-600/80 leading-relaxed">
            Engagement rate dropped below 4% on your last 2 static posts. Consider switching to Reels or carousels for the next posting cycle.
          </p>
        </div>
      </div>

      {/* Content Type Performance */}
      {formatPerf && <FormatPerformanceTable rows={formatPerf} />}

      {/* Monthly data import */}
      <div className="border border-[#1A1A1A]/8 rounded-xl px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="w-3.5 h-3.5 text-[#1A1A1A]/30" />
            <span className="text-xs text-[#1A1A1A]/40 font-medium">Monthly Data Import</span>
          </div>
          <div className="flex items-center gap-2">
            {importResult && (
              <span className="text-xs text-emerald-600">
                {importResult.imported} imported, {importResult.skipped} skipped
              </span>
            )}
            {importError && <span className="text-xs text-rose-500">{importError}</span>}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-[#1A1A1A]/10 hover:border-[#C4788A]/50 hover:text-[#8B4A5C] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? <Spinner /> : <Upload className="w-3 h-3" />}
              {importing ? "Importing…" : "Import CSV"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
