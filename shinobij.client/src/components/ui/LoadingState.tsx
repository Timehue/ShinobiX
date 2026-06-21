import type { ReactNode } from "react";

export interface LoadingStateProps {
  children?: ReactNode;
  className?: string;
}

/** Canonical loading state with a spinner. Replaces raw "Loading…" text. */
export function LoadingState({ children = "Loading…", className = "" }: LoadingStateProps) {
  return (
    <div className={`ui-loading ${className}`.trim()} role="status" aria-live="polite">
      <div className="ui-spinner" aria-hidden="true" />
      <p className="ui-empty-msg">{children}</p>
    </div>
  );
}
