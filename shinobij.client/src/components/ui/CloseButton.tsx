import type { ButtonHTMLAttributes } from "react";
import { FiX } from "../icons/LightweightGameIcons";

export interface CloseButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
}

/** Canonical close control for dialogs, drawers, and popovers. */
export function CloseButton({ label = "Close", className = "", ...rest }: CloseButtonProps) {
  return (
    <button
      type="button"
      className={`ui-close-btn ${className}`.trim()}
      aria-label={label}
      {...rest}
    >
      <FiX aria-hidden="true" />
    </button>
  );
}
