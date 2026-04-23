import { Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { HeatmapSlot } from "@/types";

// Timestamps stored as UTC. Toronto is EDT (UTC-4) Apr–Nov, EST (UTC-5) Nov–Mar.
// We use UTC-4 as the display offset (close enough for a 1h heatmap cell).
const UTC_OFFSET = 4;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Show only the hours that have real data: 6pm–11pm EST = 22–03 UTC
const DISPLAY_HOURS_EST = [17, 18, 19, 20, 21, 22, 23];

function estToUtc(h: number): number {
  return (h + UTC_OFFSET) % 24;
}

function fmtHour(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

function heatLevel(score: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (score === 0 || max === 0) return 0;
  const pct = score / max;
  if (pct >= 0.75) return 4;
  if (pct >= 0.45) return 3;
  if (pct >= 0.20) return 2;
  return 1;
}

function heatColor(level: 0 | 1 | 2 | 3 | 4): string {
  switch (level) {
    case 1: return "bg-[#F5EEF0]";
    case 2: return "bg-[#EAC5CC]";
    case 3: return "bg-[#C4788A]";
    case 4: return "bg-[#8B4A5C]";
    default: return "bg-[#1A1A1A]/4";
  }
}

interface Props {
  slots: HeatmapSlot[];
}

export function PostingHeatmap({ slots }: Props) {
  // Build lookup: { dow_hour_utc -> score }
  const lookup = new Map<string, HeatmapSlot>();
  for (const s of slots) {
    lookup.set(`${s.dow}_${s.hour}`, s);
  }

  const maxScore = Math.max(...slots.map((s) => s.score), 1);

  // Find top 3 slots for the annotation row
  const top3 = [...slots]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => {
      const estHour = (s.hour - UTC_OFFSET + 24) % 24;
      return `${DAYS[s.dow]} ${fmtHour(estHour)}`;
    });

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        <Clock className="w-4 h-4 text-[#C4788A]" />
        <p className="text-xs font-semibold text-[#1A1A1A]/60 uppercase tracking-wide">
          Best Posting Times
        </p>
        <span className="text-[10px] text-[#1A1A1A]/30 ml-1">based on shares + saves</span>
      </div>

      {/* Top slots summary */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {top3.map((label, i) => (
          <span
            key={i}
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
              i === 0
                ? "bg-[#8B4A5C] text-white"
                : i === 1
                ? "bg-[#C4788A] text-white"
                : "bg-[#EAC5CC] text-[#6B2A3A]"
            }`}
          >
            {i === 0 ? "🏆 " : ""}{label}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[380px]">
          {/* Day headers */}
          <div className="grid grid-cols-8 gap-1 mb-1">
            <div />
            {DAYS.map((d) => (
              <div key={d} className="text-[10px] text-center text-[#1A1A1A]/40 font-medium">
                {d}
              </div>
            ))}
          </div>

          {/* Rows — one per EST hour */}
          {DISPLAY_HOURS_EST.map((estHour) => {
            const utcHour = estToUtc(estHour);
            return (
              <div key={estHour} className="grid grid-cols-8 gap-1 mb-1">
                <div className="text-[10px] text-[#1A1A1A]/40 flex items-center justify-end pr-1 whitespace-nowrap">
                  {fmtHour(estHour)}
                </div>
                {DAYS.map((_, dow) => {
                  const slot = lookup.get(`${dow}_${utcHour}`);
                  const score = slot?.score ?? 0;
                  const level = heatLevel(score, maxScore);
                  const title = slot
                    ? `${DAYS[dow]} ${fmtHour(estHour)} — ${slot.posts} post${slot.posts !== 1 ? "s" : ""}, ${slot.shares} shares, ${slot.saves} saves`
                    : `${DAYS[dow]} ${fmtHour(estHour)} — no data`;
                  return (
                    <div
                      key={dow}
                      className={`h-7 rounded ${heatColor(level)} transition-opacity`}
                      title={title}
                    />
                  );
                })}
              </div>
            );
          })}

          {/* Legend */}
          <div className="flex items-center gap-2 mt-3 justify-end">
            <span className="text-[10px] text-[#1A1A1A]/30">Low</span>
            {([1, 2, 3, 4] as const).map((l) => (
              <div key={l} className={`w-5 h-3 rounded ${heatColor(l)}`} />
            ))}
            <span className="text-[10px] text-[#1A1A1A]/30">High</span>
          </div>

          <p className="text-[10px] text-[#1A1A1A]/25 mt-2 text-right">Times shown in EST</p>
        </div>
      </div>
    </Card>
  );
}
