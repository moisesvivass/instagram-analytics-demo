import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight, Heart, MessageCircle, Eye, Bookmark } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { MediaBadge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { getPosts } from "@/services/api";
import { useApi } from "@/hooks/useApi";
import { formatNumber, formatPercent, formatDate, getEngagementRateColor } from "@/lib/utils";
import type { Comment } from "@/types";

interface LatestPostCardProps {
  recentComments?: Comment[];
}

const MAX_POSTS = 5;

export function LatestPostCard({ recentComments }: LatestPostCardProps) {
  const [index, setIndex] = useState(0);
  const fetcher = useCallback(() => getPosts("date"), []);
  const { data: posts, loading, error } = useApi(fetcher);

  if (loading) {
    return (
      <Card>
        <CardTitle>Latest Post</CardTitle>
        <div className="flex justify-center py-8"><Spinner /></div>
      </Card>
    );
  }

  if (error || !posts || posts.length === 0) {
    return (
      <Card>
        <CardTitle>Latest Post</CardTitle>
        <p className="text-[#1A1A1A]/40 text-sm py-4 text-center">
          {error ?? "No posts available."}
        </p>
      </Card>
    );
  }

  const visible = posts.slice(0, MAX_POSTS);
  const post    = visible[index];
  const canPrev = index > 0;
  const canNext = index < visible.length - 1;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CardTitle>Latest Post</CardTitle>
          <span className="text-[#1A1A1A]/30 text-xs">
            {index + 1} / {visible.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIndex((i) => i - 1)}
            disabled={!canPrev}
            className="p-1.5 rounded-lg border border-[#1A1A1A]/10 text-[#1A1A1A]/40 hover:text-[#1A1A1A] hover:border-[#1A1A1A]/20 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous post"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIndex((i) => i + 1)}
            disabled={!canNext}
            className="p-1.5 rounded-lg border border-[#1A1A1A]/10 text-[#1A1A1A]/40 hover:text-[#1A1A1A] hover:border-[#1A1A1A]/20 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            aria-label="Next post"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-[#1A1A1A]/5">
          <img src={post.thumbnail_url} alt="" className="w-full h-full object-cover" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <MediaBadge type={post.media_type} />
            <span className="text-[#1A1A1A]/40 text-xs">{formatDate(post.timestamp)}</span>
          </div>
          <p className="text-[#1A1A1A]/80 text-sm leading-snug line-clamp-2 mb-3">
            {post.caption}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="flex items-center gap-1 text-[#1A1A1A]/50 text-xs">
              <Heart className="w-3 h-3 text-rose-400" />
              <span>{formatNumber(post.like_count)}</span>
            </div>
            <div className="flex items-center gap-1 text-[#1A1A1A]/50 text-xs">
              <MessageCircle className="w-3 h-3 text-violet-400" />
              <span>{formatNumber(post.comments_count)}</span>
            </div>
            <div className="flex items-center gap-1 text-[#1A1A1A]/50 text-xs">
              <Eye className="w-3 h-3 text-amber-400" />
              <span>{formatNumber(post.reach)}</span>
            </div>
            <div className="flex items-center gap-1 text-[#1A1A1A]/50 text-xs">
              <Bookmark className="w-3 h-3 text-emerald-400" />
              <span className={`font-semibold ${getEngagementRateColor(post.engagement_rate)}`}>
                {formatPercent(post.engagement_rate)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent comments — rendered from recentComments prop (with username) */}
      {recentComments && recentComments.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[#1A1A1A]/8 space-y-2.5">
          <p className="text-[#1A1A1A]/30 text-xs uppercase tracking-wide">Recent Comments</p>
          {recentComments.map((c) => (
            <div key={c.comment_id} className="flex items-start gap-2.5">
              {c.username && (
                <div className="w-6 h-6 rounded-full bg-[#F5EEF0] border border-[#EAC5CC] flex items-center justify-center text-[10px] font-semibold text-[#8B4A5C] shrink-0">
                  {c.username.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                {c.username && (
                  <span className="text-xs font-semibold text-[#1A1A1A]/70">@{c.username}</span>
                )}
                <p className="text-xs text-[#1A1A1A]/50 leading-snug mt-0.5 line-clamp-2">{c.text}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
