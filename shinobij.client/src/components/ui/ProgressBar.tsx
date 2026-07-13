import type { HTMLAttributes } from "react";

type ProgressTone = "gold" | "health" | "chakra" | "stamina" | "ap" | "spirit";

export interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  value: number;
  max: number;
  label: string;
  tone?: ProgressTone;
  showValue?: boolean;
}

export function ProgressBar({ value, max, label, tone = "gold", showValue = true, className = "", ...rest }: ProgressBarProps) {
  const safeMax = Math.max(1, max);
  const safeValue = Math.min(safeMax, Math.max(0, value));
  const percent = Math.round((safeValue / safeMax) * 100);
  return (
    <div className={`ui-progress ui-progress--${tone} ${className}`.trim()} {...rest}>
      <div className="ui-progress-meta">
        <span>{label}</span>
        {showValue && <strong>{safeValue.toLocaleString()} / {safeMax.toLocaleString()}</strong>}
      </div>
      <div
        className="ui-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={safeValue}
      >
        <span className="ui-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
