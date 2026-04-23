import { Share2, Bookmark, Eye, Film } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatNumber } from "@/lib/utils";
import type { ThisWeek } from "@/types";

interface ThisWeekWidgetProps {
  data: ThisWeek;
}

function WeekStat({
  icon,
  value,
  label,
  deltaPct,
}: {
  icon: React.ReactNode;
  value: number | undefined;
  label: string;
  deltaPct: number | null;
}) {
  const deltaUp = deltaPct !== null && deltaPct >= 0;
  return (
    <Card>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-2xl font-semibold text-[#1A1A1A] mt-1">{formatNumber(value ?? 0)}</p>
      {deltaPct !== null ? (
        <p className={`text-xs font-medium mt-1 ${deltaUp ? "text-emerald-500" : "text-rose-400"}`}>
          {deltaUp ? "↑" : "↓"} {Math.abs(deltaPct).toFixed(1)}% vs last week
        </p>
      ) : (
        <p className="text-[10px] mt-1 text-[#1A1A1A]/25">no prev. data</p>
      )}
    </Card>
  );
}

export function ThisWeekWidget({ data }: ThisWeekWidgetProps) {
  return (
    <div>
      <p className="text-xs font-semibold text-[#1A1A1A]/40 uppercase tracking-wide mb-3">
        This Week
      </p>
      <div className="grid grid-cols-2 gap-3">
        <WeekStat
          icon={<Eye className="w-3.5 h-3.5 text-violet-400" />}
          value={data.reach_this_week}
          label="Reach"
          deltaPct={data.reach_delta_pct ?? null}
        />
        <WeekStat
          icon={<Film className="w-3.5 h-3.5 text-amber-400" />}
          value={data.posts_this_week}
          label="Posts"
          deltaPct={data.posts_delta_pct ?? null}
        />
        <WeekStat
          icon={<Share2 className="w-3.5 h-3.5 text-rose-400" />}
          value={data.shares_this_week}
          label="Shares"
          deltaPct={data.shares_delta_pct}
        />
        <WeekStat
          icon={<Bookmark className="w-3.5 h-3.5 text-emerald-400" />}
          value={data.saves_this_week}
          label="Saves"
          deltaPct={data.saves_delta_pct}
        />
      </div>
    </div>
  );
}
