import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Canonical empty state. Replaces p.council-empty / p.hint / generic card text. */
export function EmptyState({ icon, title, children, className = "" }: EmptyStateProps) {
  return (
    <div className={`ui-empty ${className}`.trim()}>
      {icon != null && <div className="ui-empty-icon" aria-hidden="true">{icon}</div>}
      {title != null && <p className="ui-empty-title">{title}</p>}
      {children != null && <p className="ui-empty-msg">{children}</p>}
    </div>
  );
}
