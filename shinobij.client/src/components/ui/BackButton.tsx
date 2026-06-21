import type { ButtonHTMLAttributes } from "react";

export interface BackButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
}

/** Canonical ← back button. Standardizes back-btn / back-to-hub-btn / pl-back / … */
export function BackButton({ label = "Back", className = "", children, ...rest }: BackButtonProps) {
  return (
    <button type="button" className={`ui-back-btn ${className}`.trim()} {...rest}>
      {children ?? label}
    </button>
  );
}
