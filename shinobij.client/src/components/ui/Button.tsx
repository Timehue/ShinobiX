import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success" | "info";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  children?: ReactNode;
}

/**
 * Canonical button. Replaces the ~59 bespoke button classes across screens.
 * Renders a real <button> so it inherits accessibility + existing handlers.
 */
export function Button({
  variant = "secondary",
  size = "md",
  block = false,
  loading = false,
  loadingLabel = "Working…",
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const cls = [
    "ui-btn",
    `ui-btn--${variant}`,
    `ui-btn--${size}`,
    block ? "ui-btn--block" : "",
    loading ? "is-loading" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type={type}
      className={cls}
      {...rest}
      aria-busy={loading || undefined}
      disabled={loading || rest.disabled}
    >
      {loading && <span className="ui-btn-spinner" aria-hidden="true" />}
      <span>{loading ? loadingLabel : children}</span>
    </button>
  );
}
