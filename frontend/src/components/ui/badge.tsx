import { cn } from "@/lib/utils";
import type { MediaType } from "@/types";

const mediaStyles: Record<MediaType, string> = {
  REEL:            "bg-[#E1306C]/10 text-[#E1306C] border-[#E1306C]/30",
  CAROUSEL_ALBUM:  "bg-[#833AB4]/10 text-[#833AB4] border-[#833AB4]/30",
  IMAGE:           "bg-[#F77737]/10 text-[#F77737] border-[#F77737]/30",
};

const mediaLabels: Record<MediaType, string> = {
  REEL: "Reel",
  CAROUSEL_ALBUM: "Carousel",
  IMAGE: "Photo",
};

interface MediaBadgeProps {
  type: MediaType;
}

export function MediaBadge({ type }: MediaBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
        mediaStyles[type]
      )}
    >
      {mediaLabels[type]}
    </span>
  );
}

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger";
  className?: string;
}

const variantStyles = {
  default: "bg-[#1A1A1A]/8 text-[#1A1A1A]/60 border-[#1A1A1A]/15",
  success: "bg-emerald-500/15 text-emerald-700 border-emerald-500/25",
  warning: "bg-amber-500/15 text-amber-700 border-amber-500/25",
  danger: "bg-rose-500/15 text-rose-600 border-rose-500/25",
};

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
