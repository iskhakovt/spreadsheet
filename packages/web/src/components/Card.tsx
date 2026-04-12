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
          "sm:border sm:border-border/40 sm:rounded-[var(--radius-lg)]",
          "sm:shadow-lg sm:shadow-accent/5 sm:px-8 sm:py-10",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
