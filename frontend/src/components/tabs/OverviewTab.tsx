import { useCallback } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Users, Eye, Activity, Heart, TrendingUp } from "lucide-react";

import { getInsights, getReachChart, getReachSources, getThisWeek } from "@/services/api";
import { TransitionTracker } from "@/components/tabs/overview/TransitionTracker";
import { ThisWeekWidget } from "@/components/tabs/overview/ThisWeekWidget";
import type { Overview, InsightItem } from "@/types";
import { useApi } from "@/hooks/useApi";
import { Card } from "@/components/ui/card";
import { LoadingOverlay, Spinner } from "@/components/ui/spinner";
import { formatNumber, formatDate } from "@/lib/utils";

function normalizeToTitleDesc(field: InsightItem[] | string): { title: string; desc: string; next_step?: string }[] {
  if (Array.isArray(field)) {
    return field.slice(0, 2).map((item) => ({ title: item.title, desc: item.insight, next_step: item.next_step }));
  }
  const cleaned = field
    .replace(/Post\s+\d+\s*\[.*?\]\s*[:\-]?\s*/gi, "")
    .replace(/^(The hook|The problem|Despite reaching[^.]+,)\s*/i, "")
    .trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) ?? [cleaned];
  return sentences.slice(0, 2).map((s) => {
    const clean = s.trim();
    const colonIdx = clean.indexOf(":");
    if (colonIdx > 0 && colonIdx < 45) {
      return { title: clean.slice(0, colonIdx).trim(), desc: clean.slice(colonIdx + 1).trim() };
    }
    const match = clean.match(/^[""]([^"""]+)["""]/);
    if (match) {
      return { title: match[1].slice(0, 40), desc: clean.replace(match[0], "").trim() };
    }
    const words = clean.split(" ");
    return { title: words.slice(0, 5).join(" "), desc: words.slice(5).join(" ") };
  });
}

interface KpiCardProps {
  title: string;
  value: string;
  timeWindow: string;
  deltaPct?: number | null;
  icon: React.ReactNode;
}

function KpiCard({ title, value, timeWindow, deltaPct, icon }: KpiCardProps) {
  const hasDelta = typeof deltaPct === "number";
  const deltaUp  = hasDelta && deltaPct >= 0;
  return (
    <Card className="border-t-2 border-t-[#C4788A]/30 overflow-hidden">
      <div className="flex items-start justify-between mb-2">
        <p className="text-[10px] sm:text-xs text-[#1A1A1A]/40 uppercase tracking-wide leading-tight">{title}</p>
        <div className="w-7 h-7 rounded-lg bg-[#C4788A]/8 flex items-center justify-center text-[#C4788A]">
          {icon}
        </div>
      </div>
      <p className="text-xl sm:text-2xl font-semibold text-[#1A1A1A]">{value}</p>
      <p className="text-[10px] text-[#1A1A1A]/30 mt-0.5 leading-tight">{timeWindow}</p>
      {hasDelta && (
        <p className={`text-xs mt-1 font-medium ${deltaUp ? "text-emerald-500" : "text-rose-400"}`}>
          {deltaUp ? "↑" : "↓"} {Math.abs(deltaPct).toFixed(1)}% vs last week
        </p>
      )}
    </Card>
  );
}


interface OverviewTabProps {
  overview: Overview | null;
  ovLoading: boolean;
  ovError: string | null;
  refreshKey: number;
}

export function OverviewTab({ overview, ovLoading, ovError, refreshKey }: OverviewTabProps) {
  const reachFetcher    = useCallback(() => getReachChart(),   [refreshKey]);
  const sourcesFetcher  = useCallback(() => getReachSources(), [refreshKey]);
  const thisWeekFetcher = useCallback(() => getThisWeek(),     [refreshKey]);
  const insightsFetcher = useCallback(() => getInsights(),     []);

  const { data: reachData,    loading: rcLoading } = useApi(reachFetcher);
  const { data: reachSources                     } = useApi(sourcesFetcher);
  const { data: thisWeek                         } = useApi(thisWeekFetcher);
  const { data: insights                         } = useApi(insightsFetcher);

  if (ovLoading) return <LoadingOverlay label="Loading overview..." />;
  if (ovError)   return <p className="text-rose-500 py-8 text-center">{ovError}</p>;
  if (!overview) return null;

  const workingBullets  = insights ? normalizeToTitleDesc(insights.what_working)  : [];
  const floppingBullets = insights ? normalizeToTitleDesc(insights.what_flopping) : [];

  return (
    <div className="space-y-5">

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard title="Followers"        value={overview.followers.toLocaleString()}     timeWindow="real-time"    deltaPct={overview.followers_delta_pct}        icon={<Users      className="w-4 h-4" />} />
        <KpiCard title="28d Reach"        value={formatNumber(overview.reach_28d)}        timeWindow="last 28 days" deltaPct={overview.reach_28d_delta_pct}        icon={<Eye        className="w-4 h-4" />} />
        <KpiCard title="Profile Views"    value={formatNumber(overview.profile_views)}    timeWindow="last 28 days" deltaPct={overview.profile_views_delta_pct}    icon={<Activity   className="w-4 h-4" />} />
        <KpiCard title="Accounts Engaged" value={formatNumber(overview.accounts_engaged)} timeWindow="last 28 days" deltaPct={overview.accounts_engaged_delta_pct} icon={<Heart      className="w-4 h-4" />} />
        <KpiCard title="Interactions"     value={formatNumber(overview.interactions)}     timeWindow="last 28 days" deltaPct={overview.interactions_delta_pct}     icon={<TrendingUp className="w-4 h-4" />} />
      </div>

      {/* ── What's Working / Flopping ── */}
      {insights && (
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-emerald-50/50 border-emerald-100">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">What's working</p>
            </div>
            <div className="space-y-4">
              {workingBullets.map((b, i) => (
                <div key={i}>
                  <p className="text-sm font-semibold text-[#1A1A1A]">{b.title}</p>
                  <p className="text-xs text-[#1A1A1A]/60 mt-0.5 leading-relaxed">{b.desc}</p>
                  {b.next_step && (
                    <p className="text-xs text-[#1A1A1A]/40 mt-0.5 leading-relaxed">→ {b.next_step}</p>
                  )}
                  {i === 0 && (
                    <span className="inline-block mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                      ✓ Top performer
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card className="bg-rose-50/40 border-rose-100">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
              <p className="text-xs font-semibold text-rose-500 uppercase tracking-wide">What's flopping</p>
            </div>
            <div className="space-y-4">
              {floppingBullets.map((b, i) => (
                <div key={i}>
                  <p className="text-sm font-semibold text-[#1A1A1A]">{b.title}</p>
                  <p className="text-xs text-[#1A1A1A]/60 mt-0.5 leading-relaxed">{b.desc}</p>
                  {b.next_step && (
                    <p className="text-xs text-[#1A1A1A]/40 mt-0.5 leading-relaxed">→ {b.next_step}</p>
                  )}
                  {i === 0 && (
                    <span className="inline-block mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-rose-50 text-rose-600">
                      ✗ Needs attention
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── Transition Tracker ── */}
      <TransitionTracker />

      {/* ── Daily Reach Chart + This Week (side-by-side on xl) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4 items-start">
      <Card>
        <p className="text-xs font-semibold text-[#1A1A1A]/40 uppercase tracking-wide mb-3">Daily Reach — Last 28 Days</p>
        {rcLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : reachData ? (
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={reachData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="reachGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#C4788A" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#C4788A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,26,26,0.05)" />
              <XAxis dataKey="date" tickFormatter={(v: string) => formatDate(v)} tick={{ fill: "rgba(26,26,26,0.35)", fontSize: 10 }} axisLine={false} tickLine={false} interval={6} />
              <YAxis tickFormatter={(v: number) => formatNumber(v)} tick={{ fill: "rgba(26,26,26,0.35)", fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                contentStyle={{ backgroundColor: "#fff", border: "1px solid rgba(26,26,26,0.08)", borderRadius: 8, fontSize: 11 }}
                formatter={(value: number) => [formatNumber(value), "Reach"]}
                labelFormatter={(label: string) => formatDate(label)}
              />
              <Area type="monotone" dataKey="reach" stroke="#C4788A" strokeWidth={1.5} fill="url(#reachGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : null}

        {/* Reach by surface breakdown bar */}
        {reachSources && reachSources.total > 0 && (() => {
          const reelPct     = Math.round(reachSources.reel     / reachSources.total * 100);
          const storyPct    = Math.round(reachSources.story    / reachSources.total * 100);
          const carouselPct = Math.round(reachSources.carousel / reachSources.total * 100);
          return (
            <div className="mt-4 pt-3 border-t border-[#1A1A1A]/6">
              <p className="text-[10px] text-[#1A1A1A]/35 uppercase tracking-wide mb-2">Reach by surface — last 28 days</p>
              <div className="flex rounded-full overflow-hidden h-2 mb-2">
                <div className="bg-rose-400"   style={{ width: `${reelPct}%` }} />
                <div className="bg-violet-400" style={{ width: `${storyPct}%` }} />
                <div className="bg-amber-400"  style={{ width: `${carouselPct}%` }} />
              </div>
              <div className="flex gap-4 text-[10px] text-[#1A1A1A]/50">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-rose-400 shrink-0" />
                  Reels {reelPct}% <span className="text-[#1A1A1A]/30">({formatNumber(reachSources.reel)})</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-violet-400 shrink-0" />
                  Stories {storyPct}% <span className="text-[#1A1A1A]/30">({formatNumber(reachSources.story)})</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-amber-400 shrink-0" />
                  Carousel {carouselPct}% <span className="text-[#1A1A1A]/30">({formatNumber(reachSources.carousel)})</span>
                </span>
              </div>
            </div>
          );
        })()}
      </Card>

      {/* This Week — inside the xl grid on wide screens, hidden below (rendered separately on small) */}
      <div className="hidden xl:block">
        {thisWeek && <ThisWeekWidget data={thisWeek} />}
      </div>
      </div>

      {/* ── This Week — visible only on < xl ── */}
      <div className="xl:hidden">
        {thisWeek && <ThisWeekWidget data={thisWeek} />}
      </div>

    </div>
  );
}
