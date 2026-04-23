import { BarChart2, Film, Zap } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import type { Post } from "@/types";

type FilterType = "all" | "IMAGE" | "CAROUSEL_ALBUM" | "VIDEO";
type SortType   = "date" | "engagement_rate" | "reach" | "performance";

interface Props {
  posts: Post[];
  filter: FilterType;
  sort: SortType;
}

const PERF_RANK: Record<string, number> = {
  winner: 4, promising: 3, neutral: 2, underperformer: 1,
};

const FORMAT_LABEL: Record<string, string> = {
  REEL: "Reel", CAROUSEL_ALBUM: "Carousel", IMAGE: "Photo",
};

// ── Format Breakdown (default) ────────────────────────────────────────────────

function FormatBreakdown({ posts }: { posts: Post[] }) {
  const grouped = posts.reduce<Record<string, { saves: number; shares: number; count: number }>>(
    (acc, p) => {
      const key = p.media_type;
      if (!acc[key]) acc[key] = { saves: 0, shares: 0, count: 0 };
      acc[key].saves  += p.saved;
      acc[key].shares += p.shares;
      acc[key].count  += 1;
      return acc;
    },
    {}
  );

  const rows = Object.entries(grouped)
    .filter(([, g]) => g.count > 0)
    .map(([type, g]) => ({
      type,
      label: FORMAT_LABEL[type] ?? type,
      avgSaves:  Math.round(g.saves  / g.count),
      avgShares: Math.round(g.shares / g.count),
      count: g.count,
    }))
    .sort((a, b) => b.avgSaves - a.avgSaves);

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <BarChart2 className="w-4 h-4 text-[#8B4A5C]" />
        <span className="text-sm font-semibold text-[#6B2A3A]">Format Breakdown</span>
      </div>

      <p className="text-[10px] text-[#8B4A5C]/60 mb-3 leading-relaxed">
        Avg saves & shares by content type.
      </p>

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.type}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[#6B2A3A]">{r.label}</span>
              <span className="text-[10px] text-[#8B4A5C]/50">{r.count} posts</span>
            </div>
            <div className="flex gap-2 text-[10px] text-[#8B4A5C]/70">
              <span className="flex-1 bg-white/60 rounded-lg px-2 py-1 text-center">
                <span className="block font-semibold text-[#1A1A1A] text-xs">{formatNumber(r.avgSaves)}</span>
                saves avg
              </span>
              <span className="flex-1 bg-white/60 rounded-lg px-2 py-1 text-center">
                <span className="block font-semibold text-[#1A1A1A] text-xs">{formatNumber(r.avgShares)}</span>
                shares avg
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Reel Benchmarks ───────────────────────────────────────────────────────────

function ReelBenchmarks({ posts }: { posts: Post[] }) {
  const reels = posts.filter((p) => p.media_type === "REEL");

  if (reels.length === 0) {
    return (
      <>
        <div className="flex items-center gap-2 mb-3">
          <Film className="w-4 h-4 text-[#8B4A5C]" />
          <span className="text-sm font-semibold text-[#6B2A3A]">Reel Benchmarks</span>
        </div>
        <p className="text-xs text-[#8B4A5C]/60">No Reels found in current data.</p>
      </>
    );
  }

  const avgReach = Math.round(reels.reduce((s, p) => s + p.reach, 0) / reels.length);
  const avgSaves = Math.round(reels.reduce((s, p) => s + p.saved, 0) / reels.length);

  const top5 = [...reels].sort((a, b) => b.reach - a.reach).slice(0, 5);

  const hooks = top5
    .map((p) => {
      const cap = p.caption?.trim() ?? "";
      const match = cap.match(/^[^.!?\n]+[.!?]?/);
      const raw = match ? match[0] : cap;
      return raw.slice(0, 55).trim();
    })
    .filter(Boolean);

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <Film className="w-4 h-4 text-[#8B4A5C]" />
        <span className="text-sm font-semibold text-[#6B2A3A]">Reel Benchmarks</span>
      </div>

      <div className="space-y-2 mb-4">
        <div className="bg-white/60 rounded-lg px-3 py-2">
          <p className="text-[10px] text-[#8B4A5C]/60">Avg reach</p>
          <p className="text-sm font-semibold text-[#1A1A1A]">{formatNumber(avgReach)}</p>
        </div>
        <div className="bg-white/60 rounded-lg px-3 py-2">
          <p className="text-[10px] text-[#8B4A5C]/60">Avg saves</p>
          <p className="text-sm font-semibold text-[#1A1A1A]">{formatNumber(avgSaves)}</p>
        </div>
        <div className="bg-white/60 rounded-lg px-3 py-2">
          <p className="text-[10px] text-[#8B4A5C]/60">Avg views</p>
          <p className="text-sm font-semibold text-[#1A1A1A]">—</p>
        </div>
      </div>

      {hooks.length > 0 && (
        <>
          <p className="text-[10px] font-semibold text-[#6B2A3A] mb-2 uppercase tracking-wider">
            Top {hooks.length} hooks
          </p>
          <ul className="space-y-2">
            {hooks.map((hook, i) => (
              <li key={i} className="text-[10px] text-[#8B4A5C]/80 leading-snug bg-white/60 rounded-lg px-2 py-1.5">
                "{hook}{hook.length === 55 ? "…" : ""}"
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

// ── Top Post Patterns ─────────────────────────────────────────────────────────

function TopPostPatterns({ posts }: { posts: Post[] }) {
  const top5 = [...posts]
    .sort(
      (a, b) =>
        (PERF_RANK[b.perf_label ?? "neutral"] ?? 2) -
        (PERF_RANK[a.perf_label ?? "neutral"] ?? 2)
    )
    .slice(0, 5);

  if (top5.length === 0) {
    return (
      <>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-[#8B4A5C]" />
          <span className="text-sm font-semibold text-[#6B2A3A]">Top Patterns</span>
        </div>
        <p className="text-xs text-[#8B4A5C]/60">Not enough data yet.</p>
      </>
    );
  }

  const reaches  = top5.map((p) => p.reach);
  const saves    = top5.map((p) => p.saved);
  const capLens  = top5.map((p) => p.caption?.length ?? 0);

  const reachMin = Math.min(...reaches);
  const reachMax = Math.max(...reaches);
  const savesMin = Math.min(...saves);
  const savesMax = Math.max(...saves);
  const avgCapLen = Math.round(capLens.reduce((s, l) => s + l, 0) / top5.length);

  const formatCounts = top5.reduce<Record<string, number>>((acc, p) => {
    acc[p.media_type] = (acc[p.media_type] ?? 0) + 1;
    return acc;
  }, {});
  const dominantFormat =
    FORMAT_LABEL[
      Object.entries(formatCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""
    ] ?? "Mixed";

  const patterns = [
    {
      label: "Reach range",
      value: `${formatNumber(reachMin)} – ${formatNumber(reachMax)}`,
    },
    {
      label: "Saves range",
      value: `${formatNumber(savesMin)} – ${formatNumber(savesMax)}`,
    },
    {
      label: "Caption length",
      value: `~${avgCapLen} chars`,
    },
    {
      label: "Dominant format",
      value: dominantFormat,
    },
  ];

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-[#8B4A5C]" />
        <span className="text-sm font-semibold text-[#6B2A3A]">Top Patterns</span>
      </div>

      <p className="text-[10px] text-[#8B4A5C]/60 mb-3 leading-relaxed">
        What your top 5 posts share.
      </p>

      <div className="space-y-2">
        {patterns.map(({ label, value }) => (
          <div key={label} className="bg-white/60 rounded-lg px-3 py-2">
            <p className="text-[10px] text-[#8B4A5C]/60">{label}</p>
            <p className="text-xs font-semibold text-[#1A1A1A]">{value}</p>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function IntelligentSidebar({ posts, filter, sort }: Props) {
  const showReelBenchmarks   = filter === "VIDEO";
  const showTopPatterns      = sort === "performance" && filter === "all";

  return (
    <div className="w-52 shrink-0 hidden lg:block">
      <div className="bg-[#F5EEF0] border border-[#EAC5CC] rounded-xl p-4 sticky top-4">
        {showReelBenchmarks ? (
          <ReelBenchmarks posts={posts} />
        ) : showTopPatterns ? (
          <TopPostPatterns posts={posts} />
        ) : (
          <FormatBreakdown posts={posts} />
        )}
      </div>
    </div>
  );
}
