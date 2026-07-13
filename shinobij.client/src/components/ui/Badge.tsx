import type { HTMLAttributes, ReactNode } from "react";

type BadgeTone = "neutral" | "gold" | "success" | "danger" | "info" | "spirit";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
}

export function Badge({ tone = "neutral", icon, className = "", children, ...rest }: BadgeProps) {
  return (
    <span className={`ui-badge ui-badge--${tone} ${className}`.trim()} {...rest}>
      {icon != null && <span className="ui-badge-icon" aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}
