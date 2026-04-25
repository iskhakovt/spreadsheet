/** Shared gradient + shadow class fragments for filled interactive elements.
 *  Used by Button and QuestionCard's rating radio group. */

const ACCENT_GRADIENT = "bg-gradient-to-b from-accent to-accent-dark text-accent-fg";
const ACCENT_SHADOW =
  "shadow-[0_1px_2px_rgb(58_48_40/0.08),0_2px_8px_rgb(208_128_88/0.2),inset_0_1px_0_rgb(255_255_255/0.12)]";
const ACCENT_SHADOW_HOVER =
  "hover:shadow-[0_2px_4px_rgb(58_48_40/0.1),0_4px_14px_rgb(208_128_88/0.28),inset_0_1px_0_rgb(255_255_255/0.12)]";

const ACCENT_LIGHT_GRADIENT = "bg-gradient-to-b from-accent-light to-accent-light-dark text-accent-fg";
const ACCENT_LIGHT_SHADOW =
  "shadow-[0_1px_2px_rgb(58_48_40/0.06),0_2px_6px_rgb(228_184_152/0.2),inset_0_1px_0_rgb(255_255_255/0.15)]";
const ACCENT_LIGHT_SHADOW_HOVER =
  "hover:shadow-[0_2px_4px_rgb(58_48_40/0.08),0_4px_12px_rgb(228_184_152/0.25),inset_0_1px_0_rgb(255_255_255/0.15)]";

const NEUTRAL_GRADIENT = "bg-gradient-to-b from-neutral to-neutral-dark text-neutral-fg";
const NEUTRAL_SHADOW = "shadow-[0_1px_2px_rgb(58_48_40/0.06),inset_0_1px_0_rgb(255_255_255/0.1)]";
const NEUTRAL_SHADOW_HOVER = "hover:shadow-[0_2px_6px_rgb(58_48_40/0.1),inset_0_1px_0_rgb(255_255_255/0.1)]";

export const variantStyles = {
  accent: [ACCENT_GRADIENT, ACCENT_SHADOW, ACCENT_SHADOW_HOVER, "hover:brightness-[1.04]"].join(" "),
  "accent-light": [
    ACCENT_LIGHT_GRADIENT,
    ACCENT_LIGHT_SHADOW,
    ACCENT_LIGHT_SHADOW_HOVER,
    "hover:brightness-[1.04]",
  ].join(" "),
  neutral: [NEUTRAL_GRADIENT, NEUTRAL_SHADOW, NEUTRAL_SHADOW_HOVER, "hover:brightness-[1.04]"].join(" "),
  outline: "bg-transparent text-neutral border-2 border-neutral/50 hover:border-neutral/70 hover:bg-neutral/5",
  ghost: "bg-transparent text-text-muted hover:text-accent hover:bg-accent/[0.04]",
} as const;

export type Variant = keyof typeof variantStyles;
