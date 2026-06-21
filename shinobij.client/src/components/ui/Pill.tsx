import type { ReactNode } from "react";

export type PillTone = "neutral" | "gold" | "green" | "red" | "blue" | "purple";

export interface PillProps {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
  title?: string;
}

/** Canonical pill/badge for tags, counts, statuses. */
export function Pill({ tone = "neutral", children, className = "", title }: PillProps) {
  const toneCls = tone === "neutral" ? "" : `ui-pill--${tone}`;
  return (
    <span className={`ui-pill ${toneCls} ${className}`.trim()} title={title}>
      {children}
    </span>
  );
}
