import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn.js";

type Variant = "accent" | "accent-light" | "neutral" | "outline" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
  fullWidth?: boolean;
}

const variantStyles: Record<Variant, string> = {
  accent: "bg-accent text-accent-fg shadow-sm hover:shadow-md hover:brightness-105",
  "accent-light": "bg-accent-light text-accent-fg shadow-sm hover:shadow-md hover:brightness-105",
  neutral: "bg-neutral text-neutral-fg shadow-sm hover:brightness-105",
  outline: "bg-transparent text-neutral border-2 border-neutral/60 hover:border-neutral hover:bg-neutral/5",
  ghost: "bg-transparent text-text-muted hover:text-accent hover:bg-accent/5",
};

export function Button({
  variant = "accent",
  fullWidth = false,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "px-6 py-4 rounded-[var(--radius-lg)] font-medium text-base",
        "transition-all duration-200 ease-out",
        "active:scale-[0.97] active:shadow-none",
        "disabled:opacity-50 disabled:pointer-events-none",
        "cursor-pointer select-none",
        variantStyles[variant],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
