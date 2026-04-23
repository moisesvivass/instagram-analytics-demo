import { useTracker } from "@/hooks/useTracker";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { formatNumber } from "@/lib/utils";
import type { TrackerMetricValue } from "@/types";

// ── MetricConfig drives all display logic ────────────────────────────────────

type TrafficLight = "green" | "yellow" | "red" | "gray";
type LightSource  = "value" | "delta_pct";
type DeltaType    = "abs" | "pct";

interface MetricConfig {
  key: string;
  label: string;
  sublabel: string;
  lightSource: LightSource;
  thresholds: { green: number; yellow: number };
  formatValue: (v: number) => string;
  deltaType: DeltaType;
  formatDeltaNum: (delta: number) => string;
  nullTooltip?: string;
}

const METRICS: MetricConfig[] = [
  {
    key: "target_market_reach",
    label: "Target Market",
    sublabel: "this month avg",
    lightSource: "value",
    thresholds: { green: 30, yellow: 20 },
    formatValue: (v) => `${v.toFixed(1)}%`,
    deltaType: "abs",
    formatDeltaNum: (d) => `${Math.abs(d).toFixed(1)}pp`,
    nullTooltip: "Available once Instagram returns demographic data for recent posts.",
  },
  {
    key: "reel_reach",
    label: "Reel Reach",
    sublabel: "last 28 days",
    lightSource: "value",
    thresholds: { green: 70, yellow: 50 },
    formatValue: (v) => `${v.toFixed(1)}%`,
    deltaType: "abs",
    formatDeltaNum: (d) => `${Math.abs(d).toFixed(1)}pp`,
    nullTooltip: "Available after the next scheduled refresh.",
  },
  {
    key: "profile_visit_conversion",
    label: "Profile Visits",
    sublabel: "last 28 days",
    lightSource: "value",
    thresholds: { green: 5, yellow: 2 },
    formatValue: (v) => `${v.toFixed(1)} /1K`,
    deltaType: "abs",
    formatDeltaNum: (d) => `${Math.abs(d).toFixed(1)} /1K`,
    nullTooltip: "Available after the first daily snapshot refresh (runs at 12:00 UTC).",
  },
  {
    key: "views_rolling_avg",
    label: "Views Rolling Avg",
    sublabel: "last 14 posts",
    lightSource: "delta_pct",
    thresholds: { green: 10, yellow: -10 },
    formatValue: (v) => formatNumber(Math.round(v)),
    deltaType: "pct",
    formatDeltaNum: (d) => `${Math.abs(d).toFixed(1)}%`,
  },
  {
    key: "content_quality_score",
    label: "Content Quality",
    sublabel: "last 14 posts",
    lightSource: "delta_pct",
    thresholds: { green: 10, yellow: -5 },
    formatValue: (v) => `${v.toFixed(2)}%`,
    deltaType: "pct",
    formatDeltaNum: (d) => `${Math.abs(d).toFixed(1)}%`,
  },
];

const LIGHT_DOT: Record<TrafficLight, string> = {
  green:  "bg-emerald-400",
  yellow: "bg-amber-400",
  red:    "bg-rose-400",
  gray:   "bg-[#1A1A1A]/15",
};

function getTrafficLight(config: MetricConfig, m: TrackerMetricValue): TrafficLight {
  if (m.current === null) return "gray";
  const lightVal = config.lightSource === "value" ? m.current : m.delta_pct;
  if (lightVal === null) return "gray";
  return lightVal >= config.thresholds.green ? "green"
    : lightVal >= config.thresholds.yellow   ? "yellow"
    : "red";
}

function getDelta(config: MetricConfig, m: TrackerMetricValue): { text: string; up: boolean } | null {
  if (m.current === null || m.previous === null) return null;
  const raw = config.deltaType === "abs" ? m.delta_abs : m.delta_pct;
  if (raw === null) return null;
  const sign = raw >= 0 ? "+" : "−";
  return { text: `${sign}${config.formatDeltaNum(raw)} vs last week`, up: raw >= 0 };
}

// ── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({ config, data }: { config: MetricConfig; data: TrackerMetricValue }) {
  const light = getTrafficLight(config, data);
  const delta = getDelta(config, data);

  return (
    <Card title={data.current === null && config.nullTooltip ? config.nullTooltip : undefined}>
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <p className="text-[10px] sm:text-xs text-[#1A1A1A]/40 uppercase tracking-wide leading-tight truncate">
            {config.label}
          </p>
          <p className="text-[10px] text-[#1A1A1A]/30 leading-tight mt-0.5 truncate">
            {config.sublabel}
          </p>
        </div>
        <span className={`mt-0.5 shrink-0 w-2.5 h-2.5 rounded-full ml-2 ${LIGHT_DOT[light]}`} />
      </div>

      <p className="text-xl sm:text-2xl font-semibold text-[#1A1A1A] mt-1">
        {data.current !== null ? config.formatValue(data.current) : "—"}
      </p>

      {delta !== null ? (
        <p className={`text-xs mt-0.5 font-medium ${delta.up ? "text-emerald-500" : "text-rose-400"}`}>
          {delta.up ? "↑" : "↓"} {delta.text}
        </p>
      ) : data.current !== null ? (
        <p className="text-xs mt-0.5 text-[#1A1A1A]/25">no prev. data</p>
      ) : config.nullTooltip ? (
        <p className="text-[10px] mt-0.5 text-[#1A1A1A]/25 italic">Awaiting data</p>
      ) : null}
    </Card>
  );
}

// ── Main widget ──────────────────────────────────────────────────────────────

export function TransitionTracker() {
  const { tracker, loading } = useTracker();

  if (loading) {
    return (
      <Card>
        <p className="text-xs font-semibold text-[#1A1A1A]/40 uppercase tracking-wide mb-3">
          Transition Tracker
        </p>
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      </Card>
    );
  }

  if (!tracker) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-[#1A1A1A]/40 uppercase tracking-wide">
          Transition Tracker
        </p>
        <div className="flex items-center gap-3 text-[10px] text-[#1A1A1A]/30">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Green
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Watch
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" /> Action
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {METRICS.map((config) => (
          <MetricCard
            key={config.key}
            config={config}
            data={tracker[config.key as keyof typeof tracker] as TrackerMetricValue}
          />
        ))}
      </div>
    </div>
  );
}
