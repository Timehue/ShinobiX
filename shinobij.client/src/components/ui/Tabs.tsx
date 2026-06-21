import type { ReactNode } from "react";

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<T extends string = string> {
  tabs: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}

/** Canonical tab bar. Replaces cc-tab / council-tab / hol-tab / user-hub-tab / … */
export function Tabs<T extends string = string>({ tabs, active, onChange, className = "" }: TabsProps<T>) {
  return (
    <div className={`ui-tabs ${className}`.trim()} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          disabled={t.disabled}
          className={`ui-tab ${t.id === active ? "ui-tab--active" : ""}`.trim()}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
