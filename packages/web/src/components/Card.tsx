import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className }: Readonly<CardProps>) {
  return (
    <div className="min-h-screen flex items-start justify-center px-4 py-8 sm:py-12">
      <div
        className={cn(
          "w-full max-w-[480px] bg-bg/80 backdrop-blur-sm",
          "sm:bg-bg/70 sm:backdrop-blur-md sm:backdrop-saturate-[1.1]",
          "sm:border sm:border-border/30 sm:rounded-[var(--radius-lg)]",
          "sm:shadow-warm-lg sm:px-8 sm:py-10",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
