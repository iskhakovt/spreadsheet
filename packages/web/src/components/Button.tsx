import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { type Variant, variantStyles } from "../lib/variant-styles.js";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
  fullWidth?: boolean;
}

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
