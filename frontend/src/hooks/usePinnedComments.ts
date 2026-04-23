import { useState } from "react";
import type { PinnedComment } from "@/types";

const STORAGE_KEY = "demo_pinned_comments";

function load(): PinnedComment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PinnedComment[]) : [];
  } catch {
    return [];
  }
}

function save(items: PinnedComment[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function usePinnedComments() {
  const [pinned, setPinned] = useState<PinnedComment[]>(load);

  function pin(comment: Omit<PinnedComment, "id" | "pinned_at">): void {
    const next: PinnedComment = {
      ...comment,
      id: crypto.randomUUID(),
      pinned_at: new Date().toISOString(),
    };
    const updated = [next, ...pinned];
    save(updated);
    setPinned(updated);
  }

  function unpin(id: string): void {
    const updated = pinned.filter((c) => c.id !== id);
    save(updated);
    setPinned(updated);
  }

  return { pinned, pin, unpin };
}
