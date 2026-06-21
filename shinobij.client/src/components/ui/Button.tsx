import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success" | "info";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
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
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
