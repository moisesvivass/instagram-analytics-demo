import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-black/8 bg-white shadow-sm p-5",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn("text-xs font-medium text-[#1A1A1A]/50 uppercase tracking-wider mb-1", className)}>
      {children}
    </p>
  );
}

export function CardValue({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn("text-3xl font-bold text-[#1A1A1A]", className)}>
      {children}
    </p>
  );
}
