import { useState } from "react";
import { Heart, MessageCircle, Pin } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { LoadingOverlay } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/utils";
import type { Comment } from "@/types";

const DEFAULT_LIMIT  = 5;
const EXPANDED_LIMIT = 10;

interface RecentCommentsProps {
  comments: Comment[] | null;
  loading: boolean;
  error: string | null;
  pinnedIds?: Set<string>;
  onPin?: (comment: Comment) => void;
}

export function RecentComments({ comments, loading, error, pinnedIds, onPin }: RecentCommentsProps) {
  const [expanded, setExpanded] = useState(false);

  if (loading) return <LoadingOverlay label="Loading comments..." />;

  const visible = comments
    ? comments.slice(0, expanded ? EXPANDED_LIMIT : DEFAULT_LIMIT)
    : [];
  const hasMore = (comments?.length ?? 0) > DEFAULT_LIMIT && !expanded;

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <MessageCircle className="w-4 h-4 text-rose-400" />
        <CardTitle>Recent Comments</CardTitle>
      </div>

      {error && (
        <p className="text-rose-500 text-sm py-4 text-center">{error}</p>
      )}

      {!error && (!comments || comments.length === 0) && (
        <p className="text-[#1A1A1A]/40 text-sm py-4 text-center">No comments yet.</p>
      )}

      {visible.length > 0 && (
        <div className="space-y-3">
          {visible.map((c) => {
            const isPinned = pinnedIds?.has(c.comment_id) ?? false;
            return (
              <div
                key={c.comment_id}
                className="flex flex-col gap-1 p-3 rounded-lg bg-[#1A1A1A]/4 border border-[#1A1A1A]/6 hover:border-[#1A1A1A]/12 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {c.username && (
                        <span className="text-rose-500 text-xs font-semibold truncate">
                          @{c.username}
                        </span>
                      )}
                      <span className="text-[#1A1A1A]/30 text-xs shrink-0">
                        {formatDateTime(c.timestamp)}
                      </span>
                    </div>
                    <p className="text-[#1A1A1A]/80 text-sm leading-snug line-clamp-3">{c.text}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1 text-[#1A1A1A]/40 text-xs">
                      <Heart className="w-3 h-3" />
                      <span>{c.like_count}</span>
                    </div>
                    {onPin && (
                      <button
                        onClick={() => onPin(c)}
                        disabled={isPinned}
                        className={`p-1 rounded transition-colors ${
                          isPinned
                            ? "text-violet-500 cursor-default"
                            : "text-[#1A1A1A]/20 hover:text-violet-500"
                        }`}
                        aria-label={isPinned ? "Pinned to HQ" : "Add to HQ"}
                        title={isPinned ? "Pinned to HQ" : "Add to HQ"}
                      >
                        <Pin className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[#1A1A1A]/30 text-xs truncate mt-0.5">
                  On: {c.post_caption}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-3 text-xs text-rose-500 hover:text-rose-400 transition-colors w-full text-center"
        >
          View more →
        </button>
      )}
    </Card>
  );
}
