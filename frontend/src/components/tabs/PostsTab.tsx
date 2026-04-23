import { useCallback, useMemo, useState } from "react";
import {
  Heart, Bookmark, Share2, TrendingUp, Star,
  ChevronDown, ChevronUp, RefreshCw, Eye, Film, Sparkles, ImageIcon,
} from "lucide-react";

import { getPosts, forceRefresh } from "@/services/api";
import { useApi } from "@/hooks/useApi";
import { MediaBadge } from "@/components/ui/badge";
import { LoadingOverlay, Spinner } from "@/components/ui/spinner";
import { formatNumber } from "@/lib/utils";
import { PostDetailModal } from "@/components/tabs/posts/PostDetailModal";
import { IntelligentSidebar } from "@/components/tabs/posts/IntelligentSidebar";
import type { AccountAverages, Post } from "@/types";

type FilterType = "all" | "IMAGE" | "CAROUSEL_ALBUM" | "VIDEO";
type SortType   = "date" | "engagement_rate" | "reach" | "performance";

const PERF_RANK: Record<string, number> = {
  winner: 4, promising: 3, neutral: 2, underperformer: 1,
};

const SORT_OPTIONS: { value: SortType; label: string }[] = [
  { value: "date",            label: "Newest" },
  { value: "engagement_rate", label: "Engagement Rate" },
  { value: "reach",           label: "Reach" },
  { value: "performance",     label: "Performance" },
];

const DEFAULT_LIMIT = 16;
const TOP_PERFORMING_THRESHOLD = 600;

function isTopPerforming(post: Post): boolean {
  return (post.saved * 3) + (post.shares * 2) + (post.reach * 0.001) > TOP_PERFORMING_THRESHOLD;
}

function sortPosts(posts: Post[], sort: SortType): Post[] {
  const arr = [...posts];
  switch (sort) {
    case "engagement_rate":
      return arr.sort((a, b) => {
        const erA = a.reach > 0 ? (a.like_count + a.comments_count) / a.reach : 0;
        const erB = b.reach > 0 ? (b.like_count + b.comments_count) / b.reach : 0;
        return erB - erA;
      });
    case "reach":
      return arr.sort((a, b) => b.reach - a.reach);
    case "performance":
      return arr.sort(
        (a, b) =>
          (PERF_RANK[b.perf_label ?? "neutral"] ?? 2) -
          (PERF_RANK[a.perf_label ?? "neutral"] ?? 2)
      );
    default:
      return arr;
  }
}

function erColor(er: number): string {
  if (er > 8)  return "text-emerald-600 font-semibold";
  if (er >= 4) return "text-amber-600 font-semibold";
  return "text-rose-500 font-semibold";
}

function computeAverages(posts: Post[]): AccountAverages {
  if (posts.length === 0) {
    return { avg_reach: 0, avg_saves: 0, avg_shares: 0, avg_likes: 0, avg_comments: 0, avg_er: 0 };
  }
  const n = posts.length;
  return {
    avg_reach:    Math.round(posts.reduce((s, p) => s + p.reach,          0) / n),
    avg_saves:    Math.round(posts.reduce((s, p) => s + p.saved,          0) / n),
    avg_shares:   Math.round(posts.reduce((s, p) => s + p.shares,         0) / n),
    avg_likes:    Math.round(posts.reduce((s, p) => s + p.like_count,     0) / n),
    avg_comments: Math.round(posts.reduce((s, p) => s + p.comments_count, 0) / n),
    avg_er: parseFloat(
      (posts.reduce((s, p) => {
        const er = p.reach > 0 ? ((p.like_count + p.comments_count) / p.reach) * 100 : 0;
        return s + er;
      }, 0) / n).toFixed(2)
    ),
  };
}

function PostThumbnail({ url, mediaType, caption }: { url: string; mediaType: string; caption: string }) {
  const [errored, setErrored] = useState(false);

  if (!url || errored) {
    const preview = caption.trim().split(/\s+/).slice(0, 2).join(" ");
    const Icon = mediaType === "REEL" ? Film : mediaType === "CAROUSEL_ALBUM" ? Sparkles : ImageIcon;
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 px-3">
        <Icon className="w-5 h-5 text-[#C4788A]/50" />
        {preview && (
          <p className="text-[10px] text-[#1A1A1A]/35 text-center leading-snug line-clamp-2">{preview}…</p>
        )}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      className="w-full h-full object-cover"
      onError={() => setErrored(true)}
    />
  );
}

export function PostsTab() {
  const [filter, setFilter]             = useState<FilterType>("all");
  const [sort, setSort]                 = useState<SortType>("date");
  const [showAll, setShowAll]           = useState(false);
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [syncing, setSyncing]           = useState(false);
  const [syncMsg, setSyncMsg]           = useState<string | null>(null);
  const [fetchKey, setFetchKey]         = useState(0);
  // In-session cache: stores analysis text + finality flag so reopening a modal uses the correct state
  const [analysisCache, setAnalysisCache] = useState<Record<string, { text: string; isFinal: boolean }>>({});

  const fetcher = useCallback(() => getPosts("date"), [fetchKey]);
  const { data: posts, loading, error } = useApi(fetcher);

  const averages = useMemo(() => computeAverages(posts ?? []), [posts]);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await forceRefresh();
      setSyncMsg(`Synced — ${result.posts_count} posts updated`);
      setFetchKey((k) => k + 1);
    } catch {
      setSyncMsg("Sync failed — try again");
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <LoadingOverlay label="Loading posts..." />;
  if (error)   return <p className="text-rose-500 py-8 text-center">{error}</p>;
  if (!posts)  return null;

  const hasStatic = posts.some((p) => p.media_type === "IMAGE");

  const FILTERS: { value: FilterType; label: string }[] = [
    { value: "all",            label: "All" },
    { value: "VIDEO",          label: "Reels" },
    { value: "CAROUSEL_ALBUM", label: "Carousels" },
    ...(hasStatic ? [{ value: "IMAGE" as FilterType, label: "Static" }] : []),
  ];

  const filtered = filter === "all" ? posts : posts.filter((p) => p.media_type === filter);
  const sorted   = sortPosts(filtered, sort);
  const visible  = showAll ? sorted : sorted.slice(0, DEFAULT_LIMIT);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#1A1A1A]">Content Performance</h2>
          <p className="text-xs text-[#1A1A1A]/40 mt-0.5">
            Analyzing your {posts.length} most recent posts
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#1A1A1A]/10 hover:border-[#C4788A]/50 hover:text-[#8B4A5C] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? <Spinner /> : <RefreshCw className="w-3 h-3" />}
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          {syncMsg && <p className="text-[10px] text-[#1A1A1A]/40">{syncMsg}</p>}
        </div>
      </div>

      {/* Filter pills + Sort */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => { setFilter(value); setShowAll(false); }}
            className={`text-xs px-4 py-1.5 rounded-full border transition-colors ${
              filter === value
                ? "bg-[#F5EEF0] border-[#EAC5CC] text-[#8B4A5C] font-medium"
                : "border-[#1A1A1A]/10 text-[#1A1A1A]/50 hover:border-[#1A1A1A]/20 hover:text-[#1A1A1A]/70"
            }`}
          >
            {label}
          </button>
        ))}

        <div className="relative ml-auto flex items-center gap-1.5 text-xs text-[#1A1A1A]/50 border border-[#1A1A1A]/10 rounded-full px-3 py-1.5 bg-white">
          <span className="text-[#1A1A1A]/30">Sort:</span>
          <select
            value={sort}
            onChange={(e) => { setSort(e.target.value as SortType); setShowAll(false); }}
            className="appearance-none bg-transparent text-[#8B4A5C] font-medium cursor-pointer focus:outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Main layout: grid + sidebar */}
      <div className="flex gap-5 items-start">
        {/* Post grid */}
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {visible.map((post) => {
              const er = post.reach > 0
                ? ((post.like_count + post.comments_count) / post.reach) * 100
                : 0;
              const topPerforming = isTopPerforming(post);
              const isExpanded    = expandedPost === post.post_id;
              const isReel        = post.media_type === "REEL";

              return (
                <div
                  key={post.post_id}
                  className="bg-white border border-[#1A1A1A]/8 rounded-xl overflow-hidden cursor-pointer hover:border-[#EAC5CC] hover:shadow-sm transition-all"
                  onClick={() => {
                    const cached = analysisCache[post.post_id];
                    setSelectedPost({
                      ...post,
                      ai_analysis: cached?.text ?? post.ai_analysis,
                      analysis_is_final: cached?.isFinal ?? post.analysis_is_final,
                    });
                  }}
                >
                  {/* Thumbnail */}
                  <div className="relative h-36 sm:h-40 bg-[#F5EEF0]">
                    <PostThumbnail
                      url={post.thumbnail_url}
                      mediaType={post.media_type}
                      caption={post.caption ?? ""}
                    />
                    <div className="absolute top-2 left-2">
                      <MediaBadge type={post.media_type} />
                    </div>
                    {topPerforming && (
                      <div className="absolute bottom-2 left-2">
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[#C4788A] text-white font-medium">
                          <Star className="w-2.5 h-2.5" />
                          Top performing
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Card body */}
                  <div className="p-2">
                    <p className="text-[11px] text-[#1A1A1A]/70 line-clamp-1 mb-1.5 leading-snug">
                      {post.caption}
                    </p>

                    {/* Row 1: likes / saves / shares / ER */}
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <div className="flex items-center gap-1.5 text-[#1A1A1A]/50">
                        <span className="flex items-center gap-0.5">
                          <Heart className="w-2.5 h-2.5 text-rose-400" />
                          {formatNumber(post.like_count)}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Bookmark className="w-2.5 h-2.5 text-emerald-500" />
                          {formatNumber(post.saved)}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Share2 className="w-2.5 h-2.5 text-sky-500" />
                          {formatNumber(post.shares)}
                        </span>
                      </div>
                      <span className={`flex items-center gap-0.5 ${erColor(er)}`}>
                        <TrendingUp className="w-2.5 h-2.5" />
                        {er.toFixed(1)}%
                      </span>
                    </div>

                    {/* Row 2: reach / views (Reels only) / impressions */}
                    <div className="flex items-center gap-2 text-[10px] text-[#1A1A1A]/40 mb-1">
                      <span className="flex items-center gap-0.5">
                        <Eye className="w-2.5 h-2.5 text-violet-400" />
                        {formatNumber(post.reach)}
                      </span>
                      {isReel && (
                        <span className="flex items-center gap-0.5">
                          <Film className="w-2.5 h-2.5 text-amber-400" />
                          {post.views != null ? formatNumber(post.views) : "—"}
                        </span>
                      )}
                      <span className="flex items-center gap-0.5">
                        <Sparkles className="w-2.5 h-2.5 text-pink-400" />
                        {post.impressions != null ? formatNumber(post.impressions) : "—"}
                      </span>
                    </div>

                    {/* Comments toggle — stop propagation so it doesn't open modal */}
                    {post.comments && post.comments.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedPost(isExpanded ? null : post.post_id);
                        }}
                        className="mt-0.5 w-full flex items-center justify-between text-[10px] text-[#1A1A1A]/30 hover:text-[#1A1A1A]/60 transition-colors"
                      >
                        <span>{post.comments.length} comments</span>
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}

                    {isExpanded && post.comments && post.comments.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[#1A1A1A]/8 space-y-1">
                        {post.comments.map((comment, i) => (
                          <p key={i} className="text-[10px] text-[#1A1A1A]/50 leading-snug">
                            — {comment}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* View more */}
          {!showAll && sorted.length > DEFAULT_LIMIT && (
            <div className="mt-5 text-center">
              <button
                onClick={() => setShowAll(true)}
                className="text-xs text-[#8B4A5C] border border-[#EAC5CC] bg-[#F5EEF0] hover:bg-[#EAC5CC]/40 rounded-full px-5 py-2 transition-colors font-medium"
              >
                View more ({sorted.length - DEFAULT_LIMIT} remaining)
              </button>
            </div>
          )}
        </div>

        {/* Intelligent sidebar */}
        <IntelligentSidebar posts={posts} filter={filter} sort={sort} />
      </div>

      {/* Post detail modal */}
      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          averages={averages}
          onClose={() => setSelectedPost(null)}
          onAnalysisSaved={(post_id, text, isFinal) =>
            setAnalysisCache((prev) => ({ ...prev, [post_id]: { text, isFinal } }))
          }
        />
      )}
    </div>
  );
}
