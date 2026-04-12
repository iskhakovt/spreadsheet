import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn.js";

type Variant = "accent" | "accent-light" | "neutral" | "outline" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
  fullWidth?: boolean;
}

const variantStyles: Record<Variant, string> = {
  accent: [
    "bg-gradient-to-b from-accent to-[#c47048] text-accent-fg",
    "shadow-[0_1px_2px_rgb(58_48_40/0.08),0_2px_8px_rgb(208_128_88/0.2),inset_0_1px_0_rgb(255_255_255/0.12)]",
    "hover:shadow-[0_2px_4px_rgb(58_48_40/0.1),0_4px_14px_rgb(208_128_88/0.28),inset_0_1px_0_rgb(255_255_255/0.12)]",
    "hover:brightness-[1.04]",
  ].join(" "),
  "accent-light": [
    "bg-gradient-to-b from-accent-light to-[#d8a880] text-accent-fg",
    "shadow-[0_1px_2px_rgb(58_48_40/0.06),0_2px_6px_rgb(228_184_152/0.2),inset_0_1px_0_rgb(255_255_255/0.15)]",
    "hover:shadow-[0_2px_4px_rgb(58_48_40/0.08),0_4px_12px_rgb(228_184_152/0.25),inset_0_1px_0_rgb(255_255_255/0.15)]",
    "hover:brightness-[1.04]",
  ].join(" "),
  neutral: [
    "bg-gradient-to-b from-neutral to-[#9a928a] text-neutral-fg",
    "shadow-[0_1px_2px_rgb(58_48_40/0.06),inset_0_1px_0_rgb(255_255_255/0.1)]",
    "hover:shadow-[0_2px_6px_rgb(58_48_40/0.1),inset_0_1px_0_rgb(255_255_255/0.1)]",
    "hover:brightness-[1.04]",
  ].join(" "),
  outline: [
    "bg-transparent text-neutral border-2 border-neutral/50",
    "hover:border-neutral/70 hover:bg-neutral/5",
  ].join(" "),
  ghost: "bg-transparent text-text-muted hover:text-accent hover:bg-accent/[0.04]",
};

export function Button({
  variant = "accent",
  fullWidth = false,
  type = "button",
  className,
  children,
  ...props
}: Readonly<ButtonProps>) {
  return (
    <button
      type={type}
      className={cn(
        "px-6 py-4 rounded-[var(--radius-lg)] font-medium text-base",
        "transition-all duration-200 ease-out",
        "active:scale-[0.975] active:brightness-[0.97]",
        "disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none",
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
