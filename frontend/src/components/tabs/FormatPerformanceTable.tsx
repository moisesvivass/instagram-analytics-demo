import { BarChart2 } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import type { FormatPerformance } from "@/types";

export function FormatPerformanceTable({ rows }: { rows: FormatPerformance[] }) {
  if (!rows.length) return null;
  const maxSaves  = Math.max(...rows.map((r) => r.avg_saves));
  const maxShares = Math.max(...rows.map((r) => r.avg_shares));
  const maxReach  = Math.max(...rows.map((r) => r.avg_reach));

  return (
    <div className="bg-white border border-[#1A1A1A]/8 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-4">
        <BarChart2 className="w-4 h-4 text-[#C4788A]" />
        <span className="text-sm font-semibold text-[#1A1A1A]">Content Type Performance</span>
        <span className="text-xs text-[#1A1A1A]/30 ml-1">avg per post</span>
      </div>

      <div className="space-y-4">
        {rows.map((row) => {
          const isBest = row.avg_saves === maxSaves;
          return (
            <div key={row.media_type} className={`rounded-lg p-3 ${isBest ? "bg-[#F5EEF0] border border-[#EAC5CC]" : "bg-[#1A1A1A]/3"}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[#1A1A1A]">{row.label}</span>
                  {isBest && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#C4788A] text-white">Top format</span>}
                </div>
                <span className="text-[10px] text-[#1A1A1A]/40">{row.post_count} posts</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {([
                  { label: "Avg Saves",  value: row.avg_saves,  max: maxSaves,  color: "bg-emerald-400" },
                  { label: "Avg Shares", value: row.avg_shares, max: maxShares, color: "bg-sky-400" },
                  { label: "Avg Reach",  value: row.avg_reach,  max: maxReach,  color: "bg-violet-400" },
                ] as const).map(({ label, value, max, color }) => (
                  <div key={label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-[#1A1A1A]/40">{label}</span>
                      <span className="text-xs font-semibold text-[#1A1A1A]">{formatNumber(value)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#1A1A1A]/8">
                      <div className={`h-full rounded-full ${color}`} style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
