import type { ReactNode } from "react";

export interface SectionHeaderProps {
  title: ReactNode;
  /** h2 = screen title (default), h3 = subsection. */
  as?: "h2" | "h3";
  /** Right-aligned content (actions, counts). */
  actions?: ReactNode;
  className?: string;
}

/** Canonical section/screen heading with consistent rhythm + optional actions. */
export function SectionHeader({ title, as = "h2", actions, className = "" }: SectionHeaderProps) {
  const Heading = as;
  return (
    <div className={`ui-section-header ${className}`.trim()}>
      <Heading>{title}</Heading>
      {actions != null && (
        <>
          <span className="ui-section-spacer" />
          {actions}
        </>
      )}
    </div>
  );
}
