import type { ButtonHTMLAttributes } from "react";

export interface CloseButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
}

/** Canonical ✕ close button for modals/popups. Standardizes the 5+ variants. */
export function CloseButton({ label = "Close", className = "", ...rest }: CloseButtonProps) {
  return (
    <button
      type="button"
      className={`ui-close-btn ${className}`.trim()}
      aria-label={label}
      {...rest}
    >
      {"✕"}
    </button>
  );
}
