import { useCallback } from "react";
import { Flame } from "lucide-react";
import { getLastReel } from "@/services/api";
import { useApi } from "@/hooks/useApi";
import { Card } from "@/components/ui/card";
import type { LastReel, ColdStreakRisk } from "@/types";

const RISK_CONFIG: Record<ColdStreakRisk, { dot: string; label: string; bg: string }> = {
  ok:       { dot: "bg-emerald-400",            label: "text-emerald-600", bg: "border-emerald-100" },
  warning:  { dot: "bg-amber-400 animate-pulse", label: "text-amber-600",  bg: "border-amber-100"   },
  critical: { dot: "bg-rose-500 animate-pulse",  label: "text-rose-600",   bg: "border-rose-100"    },
  unknown:  { dot: "bg-gray-300",                label: "text-gray-400",   bg: "border-gray-100"    },
};

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statColor(pct: number | null): string {
  if (pct == null) return "text-[#1A1A1A]";
  if (pct >= 100) return "text-emerald-600";
  if (pct >= 50)  return "text-amber-500";
  return "text-rose-500";
}

function watchColor(sec: number | null): string {
  if (sec == null) return "text-[#1A1A1A]";
  if (sec >= 6.5)  return "text-emerald-600";
  if (sec >= 5.0)  return "text-amber-500";
  return "text-rose-500";
}

function ReelStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <p className={`text-sm font-semibold ${color ?? "text-[#1A1A1A]"}`}>{value}</p>
      <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-wide">{label}</p>
    </div>
  );
}

function ColdStreakContent({ reel }: { reel: LastReel }) {
  const config = RISK_CONFIG[reel.cold_streak_risk] ?? RISK_CONFIG.unknown;

  return (
    <Card className={`${config.bg}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-[#C4788A]" />
          <p className="text-xs font-semibold text-[#1A1A1A]/60 uppercase tracking-wide">Last Reel</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${config.dot}`} />
          <span className={`text-xs font-medium ${config.label}`}>
            {reel.cold_streak_risk === "ok" ? "No cold streak" :
             reel.cold_streak_risk === "warning" ? "Monitor" : "Don't promote"}
          </span>
        </div>
      </div>

      <p className="text-xs text-[#1A1A1A]/70 mb-3 leading-relaxed line-clamp-2">
        {reel.caption || "No caption"}
      </p>

      <div className="flex justify-between border-t border-[#1A1A1A]/5 pt-3 mb-3">
        <ReelStat label="Watch time" value={reel.avg_watch_time_sec != null ? `${reel.avg_watch_time_sec}s` : "—"} color={watchColor(reel.avg_watch_time_sec)} />
        <ReelStat label="Reach"      value={reel.reach > 0 ? reel.reach.toLocaleString() : "—"} color={statColor(reel.reach_pct_of_avg)} />
        <ReelStat label="vs avg"     value={reel.reach_pct_of_avg != null ? `${reel.reach_pct_of_avg}%` : "—"} color={statColor(reel.reach_pct_of_avg)} />
        <ReelStat label="Shares"     value={String(reel.shares)} />
        <ReelStat label="Saves"      value={String(reel.saved)} />
        <ReelStat label="Posted"     value={formatHours(reel.hours_since_posted)} />
      </div>

      <p className={`text-xs leading-relaxed ${config.label}`}>{reel.signal}</p>
    </Card>
  );
}

interface ColdStreakWidgetProps {
  refreshKey: number;
}

export function ColdStreakWidget({ refreshKey }: ColdStreakWidgetProps) {
  const fetcher = useCallback(() => getLastReel(), [refreshKey]);
  const { data: reel, loading, error } = useApi(fetcher);

  if (loading || error || !reel) return null;

  return <ColdStreakContent reel={reel} />;
}
